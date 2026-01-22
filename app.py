from flask import Flask, request, jsonify, render_template, send_file
from ultralytics import YOLO
from datetime import datetime
from pysolar.solar import get_altitude, get_azimuth
import pytz
import cv2
import numpy as np
import os
import base64
import google.generativeai as genai
from io import BytesIO
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

app = Flask(__name__)

# Configure Gemini API
genai.configure(api_key="YOUR_GEMINI_API_KEY")
gemini_model = genai.GenerativeModel("gemini-2.0-flash")

# Load YOLO models
model_pole = YOLO('pole_best.pt')
model_tank = YOLO('tank_best.pt')
model_roof = YOLO('roof_best.pt')
model_tree = YOLO('tree_best.pt')

def azimuth_to_direction(azimuth):
    directions = [
        (0, "North"), (45, "Northeast"),
        (90, "East"), (135, "Southeast"),
        (180, "South"), (225, "Southwest"),
        (270, "West"), (315, "Northwest"), (360, "North")
    ]
    closest = min(directions, key=lambda x: abs(azimuth - x[0]))
    return closest[1]

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/govt_subsidy')
def govt_subsidy():
    return render_template('govt_subsidy.html')

@app.route('/analyze', methods=['POST'])
def analyze():
    if 'image' not in request.files and 'camera_image' not in request.form:
        return jsonify({'error': 'No image provided'}), 400

    os.makedirs('uploads', exist_ok=True)
    if 'image' in request.files and request.files['image']:
        file = request.files['image']
        image_path = os.path.join('uploads', file.filename)
        file.save(image_path)
    else:
        image_data = request.form['camera_image']
        _, encoded = image_data.split(',', 1)
        data = base64.b64decode(encoded)
        image_path = os.path.join('uploads', 'camera_capture.jpg')
        with open(image_path, 'wb') as f:
            f.write(data)

    img = cv2.imread(image_path)
    height, width, _ = img.shape
    mask = np.zeros((height, width), dtype=np.uint8)
    obstructions = []

    # Run detection models
    for model, label in [
        (model_pole, 'pole'),
        (model_tank, 'tank'),
        (model_roof, 'roof'),
        (model_tree, 'tree')
    ]:
        results = model(image_path)
        for r in results:
            for box in r.boxes:
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                conf = float(box.conf[0])
                obstructions.append({
                    'label': label,
                    'confidence': round(conf, 3),
                    'bbox': [x1, y1, x2, y2]
                })
                cv2.rectangle(mask, (x1, y1), (x2, y2), 255, -1)

    free_zone = cv2.bitwise_not(mask)
    free_percent = (cv2.countNonZero(free_zone) / (width * height)) * 100

    # Solar position
    lat = float(request.form.get('latitude', 0))
    lon = float(request.form.get('longitude', 0))
    time_str = request.form.get('time')
    time = datetime.fromisoformat(time_str).astimezone(pytz.UTC) if time_str else datetime.now(pytz.UTC)

    altitude = get_altitude(lat, lon, time)
    azimuth = get_azimuth(lat, lon, time)

    suggested_orientation = round(azimuth, 2)
    orientation_dir = azimuth_to_direction(suggested_orientation)
    suggested_tilt = max(10, round(lat * 0.7, 1)) if altitude > 45 else round(lat, 1)

    return jsonify({
        'obstructions': obstructions,
        'recommended_free_area_percent': round(free_percent, 2),
        'sun_altitude': round(altitude, 2),
        'sun_azimuth': round(azimuth, 2),
        'suggested_tilt_angle': suggested_tilt,
        'suggested_orientation_deg': suggested_orientation,
        'suggested_orientation_dir': orientation_dir,
        'latitude': lat,
        'longitude': lon,
        'message': f'Place panels in largest shadow-free zones facing {orientation_dir} with tilt {suggested_tilt}°!'
    })

@app.route('/recommend', methods=['POST'])
def recommend():
    data = request.json
    prompt = f"""
You are an expert solar consultant. Based on this data:
- Free area: {data.get('free_area')}%
- Tilt: {data.get('tilt')} degrees
- Orientation: {data.get('orientation_dir')} ({data.get('orientation_deg')} degrees)

Provide concise recommendations (max 500 words) for solar utilization, panel layout, and value-added features in clean bullet points without asterisks.
"""
    response = gemini_model.generate_content(prompt)
    return jsonify({'recommendation': response.text.strip()})

@app.route('/download-report', methods=['POST'])
def download_report():
    data = request.json
    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)

    c.setFont("Helvetica-Bold", 16)
    c.drawString(50, 800, "EcoVision Solar Placement Report")

    c.setFont("Helvetica", 12)
    c.drawString(50, 770, f"Free Area: {data.get('free_area')}%")
    c.drawString(50, 750, f"Suggested Tilt: {data.get('tilt')}°")
    c.drawString(50, 730, f"Suggested Orientation: {data.get('orientation_dir')} ({data.get('orientation_deg')}°)")
    c.drawString(50, 710, f"Date/Time: {data.get('datetime')}")
    c.drawString(50, 690, f"Location: {data.get('latitude')}, {data.get('longitude')}")

    # Insert image
    img_data = data.get('image_base64')
    if img_data:
        import base64
        from PIL import Image
        import io
        img_bytes = base64.b64decode(img_data.split(',')[1])
        img = Image.open(io.BytesIO(img_bytes))
        img_io = BytesIO()
        img.save(img_io, format='PNG')
        img_io.seek(0)
        c.drawImage(ImageReader(img_io), 50, 400, width=200, height=150)

    c.drawString(50, 370, "AI Recommendations Summary:")
    text = c.beginText(50, 350)
    text.setFont("Helvetica", 10)
    for line in data.get('ai_summary', '').split('\n'):
        text.textLine(line.strip())
    c.drawText(text)

    c.save()
    buffer.seek(0)
    return send_file(buffer, as_attachment=True, download_name="solar_report.pdf", mimetype='application/pdf')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
