function showLoading(show) {
  document.getElementById('loadingOverlay').style.display = show ? 'flex' : 'none';
}

// === Camera Setup ===
const openCameraBtn = document.getElementById('openCamera');
const cameraRow = document.getElementById('cameraRow');
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const snap = document.getElementById('snap');
const cameraInput = document.getElementById('camera_image_input');

let currentStream = null;

if (openCameraBtn) {
  openCameraBtn.addEventListener('click', function () {
    cameraRow.style.display = 'flex';
    canvas.style.display = 'none';
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(stream => {
          currentStream = stream;
          video.srcObject = stream;
          video.play();
        })
        .catch(() => alert('Camera access denied or not available.'));
    } else {
      alert('Camera API not supported in this browser.');
    }
  });
}

function stopCamera() {
  if (currentStream) {
    currentStream.getTracks().forEach(track => track.stop());
    currentStream = null;
  }
  video.srcObject = null;
  cameraRow.style.display = 'none';
}

if (snap) {
  snap.addEventListener('click', function () {
    if (!currentStream) {
      alert("Please open the camera first!");
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.style.display = 'block';

    canvas.toBlob(function (blob) {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = function () {
        cameraInput.value = reader.result;
        window.lastImageDataUrl = reader.result;
      };
    }, 'image/jpeg');
  });
}

// === Upload Form ===
document.getElementById('uploadForm').addEventListener('submit', function (e) {
  e.preventDefault();
  const file = this.querySelector('input[name="image"]').files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function (event) {
      window.lastImageDataUrl = event.target.result;
    };
    reader.readAsDataURL(file);
  }

  handleAnalyze(this, 'uploadAnalyzeBtn', "Analyze Uploaded Image");
});

// === Camera Form ===
document.getElementById('cameraForm').addEventListener('submit', function (e) {
  e.preventDefault();
  handleAnalyze(this, 'cameraAnalyzeBtn', "Analyze Captured Image", true);
});

// === Handle Analyze Request ===
function handleAnalyze(formElem, btnId, btnText, stopCam = false) {
  const btn = document.getElementById(btnId);
  btn.disabled = true;
  btn.innerText = "Processing...";
  showLoading(true);

  const formData = new FormData(formElem);
  fetch('/analyze', { method: 'POST', body: formData })
    .then(res => res.json())
    .then(data => {
      displayResult(data);
      btn.disabled = false;
      btn.innerText = btnText;
      showLoading(false);
      if (stopCam) stopCamera();
    })
    .catch(() => {
      alert("Analysis failed. Please try again.");
      btn.disabled = false;
      btn.innerText = btnText;
      showLoading(false);
    });
}

// === AI Recommender ===
document.getElementById('aiRecommenderBtn').addEventListener('click', function () {
  const btn = this;
  btn.disabled = true;
  btn.innerText = "Generating...";
  showLoading(true);

  fetch('/recommend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      free_area: window.currentResult.recommended_free_area_percent,
      tilt: window.currentResult.suggested_tilt_angle,
      orientation_deg: window.currentResult.suggested_orientation_deg,
      orientation_dir: window.currentResult.suggested_orientation_dir
    })
  })
    .then(res => res.json())
    .then(data => {
      const cleanText = data.recommendation.replace(/^\*+\s?/gm, '').replace(/\n\*/g, '\n').trim();
      document.getElementById('aiOutput').innerText = cleanText;
      document.getElementById('aiCard').style.display = 'block';
      btn.disabled = false;
      btn.innerText = "Get AI Recommendations 🤖";
      showLoading(false);
    })
    .catch(() => {
      document.getElementById('aiOutput').innerText = "Error fetching recommendation.";
      document.getElementById('aiCard').style.display = 'block';
      btn.disabled = false;
      btn.innerText = "Get AI Recommendations 🤖";
      showLoading(false);
    });
});

// === Display Result ===
function displayResult(data) {
  document.getElementById('resultCard').style.display = 'block';
  document.getElementById('freeArea').innerText = data.recommended_free_area_percent;
  document.getElementById('tilt').innerText = data.suggested_tilt_angle;
  document.getElementById('orientationDir').innerText = data.suggested_orientation_dir;
  document.getElementById('orientationDeg').innerText = data.suggested_orientation_deg;
  document.getElementById('resultMessage').innerText = data.message;

  if (window.lastImageDataUrl) {
    document.getElementById('resultImage').src = window.lastImageDataUrl;
  }

  window.currentResult = data;
  document.getElementById('downloadReportBtn').style.display = 'inline-block';
}

// === Download Report ===
document.getElementById('downloadReportBtn').addEventListener('click', function () {
  showLoading(true);
  fetch('/download-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      free_area: window.currentResult.recommended_free_area_percent,
      tilt: window.currentResult.suggested_tilt_angle,
      orientation_deg: window.currentResult.suggested_orientation_deg,
      orientation_dir: window.currentResult.suggested_orientation_dir,
      datetime: new Date().toLocaleString(),
      latitude: window.currentResult.latitude || 'N/A',
      longitude: window.currentResult.longitude || 'N/A',
      ai_summary: document.getElementById('aiOutput').innerText || 'N/A',
      image_base64: window.lastImageDataUrl || null
    })
  })
    .then(response => response.blob())
    .then(blob => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = "solar_report.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      showLoading(false);
    })
    .catch(() => {
      alert("Failed to generate report.");
      showLoading(false);
    });
});
