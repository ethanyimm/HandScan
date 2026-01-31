"use strict";

const COIN_TYPES = {
  quarter: { label: "US Quarter (24.26 mm)", diameterMm: 24.26 },
  nickel: { label: "US Nickel (21.21 mm)", diameterMm: 21.21 },
  dime: { label: "US Dime (17.91 mm)", diameterMm: 17.91 },
  penny: { label: "US Penny (19.05 mm)", diameterMm: 19.05 },
  custom: { label: "Custom", diameterMm: 24.26 },
};

const LANDMARK_ORDER = [
  { key: "indexBase", label: "Index base (Jupiter crease)" },
  { key: "indexTip", label: "Index tip" },
  { key: "ringBase", label: "Ring base (Apollo crease)" },
  { key: "ringTip", label: "Ring tip" },
];

const CLOUD_REQUIRED_KEYS = LANDMARK_ORDER.map((item) => item.key);
const CLOUD_KEY_ALIASES = {
  indexbase: "indexBase",
  index_base: "indexBase",
  index_base_crease: "indexBase",
  index_tip: "indexTip",
  ringbase: "ringBase",
  ring_base: "ringBase",
  ring_base_crease: "ringBase",
  ring_tip: "ringTip",
};

const MAX_CANVAS_DIMENSION = 1200;

const state = {
  image: null,
  canvas: null,
  ctx: null,
  cvReady: false,
  mode: null,
  manualQueue: [],
  manualCoinStep: null,
  coin: {
    center: null,
    radiusPx: null,
    confidence: 0,
    source: null,
    diameterCm: COIN_TYPES.quarter.diameterMm / 10,
  },
  landmarks: {
    indexBase: null,
    indexTip: null,
    ringBase: null,
    ringTip: null,
    confidence: 0,
    source: null,
  },
};

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
  elements.imageInput = document.getElementById("imageInput");
  elements.coinType = document.getElementById("coinType");
  elements.coinDiameter = document.getElementById("coinDiameter");
  elements.detectCoinBtn = document.getElementById("detectCoinBtn");
  elements.manualCoinBtn = document.getElementById("manualCoinBtn");
  elements.autoLandmarksBtn = document.getElementById("autoLandmarksBtn");
  elements.cloudLandmarksBtn = document.getElementById("cloudLandmarksBtn");
  elements.manualLandmarksBtn = document.getElementById("manualLandmarksBtn");
  elements.clearLandmarksBtn = document.getElementById("clearLandmarksBtn");
  elements.cloudEndpoint = document.getElementById("cloudEndpoint");
  elements.cloudApiKey = document.getElementById("cloudApiKey");
  elements.length2d = document.getElementById("length2d");
  elements.length4d = document.getElementById("length4d");
  elements.ratio = document.getElementById("ratio");
  elements.confidence = document.getElementById("confidence");
  elements.status = document.getElementById("status");
  elements.canvasHint = document.getElementById("canvasHint");
  elements.canvas = document.getElementById("imageCanvas");

  state.canvas = elements.canvas;
  state.ctx = elements.canvas.getContext("2d");

  initCoinControls();
  initCloudControls();
  bindEvents();
  attachOpenCv();
  updateOutputs();
});

function initCoinControls() {
  elements.coinType.value = "quarter";
  updateCoinDiameterForType();
}

function initCloudControls() {
  elements.cloudEndpoint.value = "";
  elements.cloudApiKey.value = "";
}

function bindEvents() {
  elements.imageInput.addEventListener("change", handleImageUpload);
  elements.coinType.addEventListener("change", updateCoinDiameterForType);
  elements.coinDiameter.addEventListener("input", handleCoinDiameterInput);
  elements.detectCoinBtn.addEventListener("click", detectCoin);
  elements.manualCoinBtn.addEventListener("click", startManualCoin);
  elements.autoLandmarksBtn.addEventListener("click", autoDetectLandmarks);
  elements.cloudLandmarksBtn.addEventListener("click", runCloudLandmarks);
  elements.manualLandmarksBtn.addEventListener("click", startManualLandmarks);
  elements.clearLandmarksBtn.addEventListener("click", clearLandmarks);
  elements.canvas.addEventListener("click", handleCanvasClick);
}

function attachOpenCv() {
  if (typeof cv === "undefined") {
    setStatus("OpenCV failed to load. Coin detection unavailable.");
    return;
  }
  cv.onRuntimeInitialized = () => {
    state.cvReady = true;
    setStatus("OpenCV ready. Upload a photo.");
  };
}

function handleImageUpload(event) {
  const file = event.target.files[0];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = (loadEvent) => {
    const image = new Image();
    image.onload = () => {
      state.image = image;
      resetStateForImage();
      drawImageToCanvas(image);
      setStatus("Image loaded. Detect the coin or mark it manually.");
      elements.canvasHint.style.display = "none";
    };
    image.src = loadEvent.target.result;
  };
  reader.readAsDataURL(file);
}

function resetStateForImage() {
  state.coin.center = null;
  state.coin.radiusPx = null;
  state.coin.confidence = 0;
  state.coin.source = null;
  state.landmarks.indexBase = null;
  state.landmarks.indexTip = null;
  state.landmarks.ringBase = null;
  state.landmarks.ringTip = null;
  state.landmarks.confidence = 0;
  state.landmarks.source = null;
  state.mode = null;
  state.manualQueue = [];
  state.manualCoinStep = null;
  updateOutputs();
}

function drawImageToCanvas(image) {
  const scale = Math.min(
    1,
    MAX_CANVAS_DIMENSION / Math.max(image.width, image.height)
  );
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);
  elements.canvas.width = width;
  elements.canvas.height = height;
  state.ctx.clearRect(0, 0, width, height);
  state.ctx.drawImage(image, 0, 0, width, height);
  renderOverlay();
}

function updateCoinDiameterForType() {
  const type = elements.coinType.value;
  const typeData = COIN_TYPES[type];
  elements.coinDiameter.value = typeData.diameterMm.toFixed(2);
  elements.coinDiameter.disabled = type !== "custom";
  handleCoinDiameterInput();
}

function handleCoinDiameterInput() {
  const mmValue = Number.parseFloat(elements.coinDiameter.value);
  if (!Number.isFinite(mmValue) || mmValue <= 0) {
    setStatus("Coin diameter must be a positive number.");
    return;
  }
  state.coin.diameterCm = mmValue / 10;
  updateOutputs();
}

function startManualCoin() {
  if (!state.image) {
    setStatus("Upload an image first.");
    return;
  }
  state.mode = "manualCoin";
  state.manualCoinStep = "center";
  state.coin.center = null;
  state.coin.radiusPx = null;
  state.coin.source = "manual";
  state.coin.confidence = 0;
  setStatus("Manual coin: click the coin center.");
}

function startManualLandmarks() {
  if (!state.image) {
    setStatus("Upload an image first.");
    return;
  }
  state.mode = "manualLandmarks";
  state.manualQueue = LANDMARK_ORDER.map((item) => item.key);
  setStatus(`Manual landmarks: click ${labelForKey(state.manualQueue[0])}.`);
}

function clearLandmarks() {
  state.landmarks.indexBase = null;
  state.landmarks.indexTip = null;
  state.landmarks.ringBase = null;
  state.landmarks.ringTip = null;
  state.landmarks.confidence = 0;
  state.landmarks.source = null;
  state.mode = null;
  state.manualQueue = [];
  setStatus("Landmarks cleared.");
  renderOverlay();
  updateOutputs();
}

function handleCanvasClick(event) {
  if (!state.image) {
    return;
  }
  const point = getCanvasPoint(event);
  if (state.mode === "manualCoin") {
    handleManualCoinClick(point);
    return;
  }
  if (state.mode === "manualLandmarks") {
    handleManualLandmarkClick(point);
  }
}

function handleManualCoinClick(point) {
  if (state.manualCoinStep === "center") {
    state.coin.center = point;
    state.manualCoinStep = "edge";
    setStatus("Manual coin: click a point on the coin edge.");
  } else {
    const radiusPx = distance(state.coin.center, point);
    if (radiusPx < 5) {
      setStatus("Coin radius too small. Try again.");
      return;
    }
    state.coin.radiusPx = radiusPx;
    state.coin.confidence = 0.9;
    state.mode = null;
    state.manualCoinStep = null;
    setStatus("Manual coin set.");
  }
  renderOverlay();
  updateOutputs();
}

function handleManualLandmarkClick(point) {
  const nextKey = state.manualQueue.shift();
  if (!nextKey) {
    state.mode = null;
    return;
  }
  state.landmarks[nextKey] = point;
  if (state.manualQueue.length === 0) {
    state.mode = null;
    state.landmarks.source = "manual";
    state.landmarks.confidence = 0.9;
    setStatus("Landmarks set.");
  } else {
    setStatus(`Manual landmarks: click ${labelForKey(state.manualQueue[0])}.`);
  }
  renderOverlay();
  updateOutputs();
}

async function autoDetectLandmarks() {
  if (!state.image) {
    setStatus("Upload an image first.");
    return;
  }
  if (typeof window.detectFingerLandmarks !== "function") {
    setStatus(
      "Custom model not loaded. Implement detectFingerLandmarks in custom_model_stub.js."
    );
    return;
  }
  setStatus("Running custom landmark model...");
  try {
    const result = await window.detectFingerLandmarks(elements.canvas);
    if (!result) {
      setStatus("Model returned no landmarks.");
      return;
    }
    const nextLandmarks = {
      indexBase: result.indexBase,
      indexTip: result.indexTip,
      ringBase: result.ringBase,
      ringTip: result.ringTip,
    };
    if (!areLandmarksValid(nextLandmarks)) {
      setStatus("Model landmarks incomplete or invalid.");
      return;
    }
    state.landmarks = {
      ...nextLandmarks,
      confidence: clamp(result.confidence ?? 0.6, 0, 1),
      source: "auto",
    };
    setStatus("Landmarks detected.");
  } catch (error) {
    console.error(error);
    setStatus("Model inference failed.");
  }
  renderOverlay();
  updateOutputs();
}

async function runCloudLandmarks() {
  if (!state.image) {
    setStatus("Upload an image first.");
    return;
  }
  const endpoint = elements.cloudEndpoint.value.trim();
  if (!endpoint) {
    setStatus("Enter a cloud endpoint first.");
    return;
  }
  const apiKey = elements.cloudApiKey.value.trim();
  const url = buildRoboflowUrl(endpoint, apiKey);
  if (!url) {
    setStatus("Cloud endpoint is invalid.");
    return;
  }

  elements.cloudLandmarksBtn.disabled = true;
  setStatus("Sending image to cloud model...");

  try {
    const blob = await canvasToBlob(elements.canvas);
    if (!blob) {
      setStatus("Failed to encode the image.");
      return;
    }
    const formData = new FormData();
    formData.append("file", blob, "hand.jpg");

    const response = await fetch(url, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      setStatus(`Cloud request failed (${response.status}).`);
      return;
    }

    const payload = await response.json();
    const parsed = parseCloudResponse(payload);
    if (!parsed) {
      setStatus("Cloud response missing required keypoints.");
      return;
    }

    state.landmarks = {
      ...parsed.points,
      confidence: parsed.confidence,
      source: "cloud",
    };
    setStatus("Cloud landmarks detected.");
  } catch (error) {
    console.error(error);
    setStatus("Cloud inference failed.");
  } finally {
    elements.cloudLandmarksBtn.disabled = false;
  }

  renderOverlay();
  updateOutputs();
}

function detectCoin() {
  if (!state.image) {
    setStatus("Upload an image first.");
    return;
  }
  if (!state.cvReady) {
    setStatus("OpenCV is still loading.");
    return;
  }

  const src = cv.imread(elements.canvas);
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  const circles = new cv.Mat();

  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
  cv.medianBlur(gray, gray, 5);
  cv.Canny(gray, edges, 80, 160);

  const minDim = Math.min(gray.rows, gray.cols);
  const minDist = Math.round(minDim * 0.25);
  const minRadius = Math.round(minDim * 0.03);
  const maxRadius = Math.round(minDim * 0.25);

  cv.HoughCircles(
    gray,
    circles,
    cv.HOUGH_GRADIENT,
    1,
    minDist,
    120,
    30,
    minRadius,
    maxRadius
  );

  let bestCircle = null;
  if (circles.cols > 0) {
    for (let i = 0; i < circles.cols; i += 1) {
      const x = circles.data32F[i * 3];
      const y = circles.data32F[i * 3 + 1];
      const r = circles.data32F[i * 3 + 2];
      const coverage = circleEdgeCoverage(edges, x, y, r);
      if (coverage < 0.35) {
        continue;
      }
      const normalizedRadius = r / maxRadius;
      const score = coverage * 0.7 + normalizedRadius * 0.3;
      if (!bestCircle || score > bestCircle.score) {
        bestCircle = { x, y, r, coverage, score };
      }
    }
  }

  src.delete();
  gray.delete();
  edges.delete();
  circles.delete();

  if (!bestCircle) {
    setStatus("Coin not found. Try manual coin selection.");
    return;
  }

  state.coin.center = { x: bestCircle.x, y: bestCircle.y };
  state.coin.radiusPx = bestCircle.r;
  state.coin.confidence = clamp(bestCircle.coverage, 0, 1);
  state.coin.source = "auto";

  if (state.coin.confidence < 0.55) {
    setStatus("Coin detected with low confidence. Consider manual coin.");
  } else {
    setStatus("Coin detected.");
  }
  renderOverlay();
  updateOutputs();
}

function buildRoboflowUrl(endpoint, apiKey) {
  let url = endpoint;
  if (!/^https?:\/\//i.test(url)) {
    url = `https://detect.roboflow.com/${url.replace(/^\/+/, "")}`;
  }
  if (apiKey && !url.includes("api_key=")) {
    url += url.includes("?") ? "&" : "?";
    url += `api_key=${encodeURIComponent(apiKey)}`;
  }
  return url;
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob),
      "image/jpeg",
      0.92
    );
  });
}

function parseCloudResponse(payload) {
  if (!payload || !Array.isArray(payload.predictions)) {
    return null;
  }
  if (payload.predictions.length === 0) {
    return null;
  }
  const best = payload.predictions.reduce((current, candidate) => {
    if (!current) {
      return candidate;
    }
    const currentScore = current.confidence ?? 0;
    const nextScore = candidate.confidence ?? 0;
    return nextScore > currentScore ? candidate : current;
  }, null);

  const rawKeypoints =
    best.keypoints || best.keypoint || payload.keypoints || null;
  if (!rawKeypoints) {
    return null;
  }

  const points = {};
  const confidences = [];

  if (Array.isArray(rawKeypoints)) {
    rawKeypoints.forEach((entry) => {
      if (!entry) {
        return;
      }
      const name = entry.name || entry.class || entry.label || entry.part;
      if (!name) {
        return;
      }
      const key = mapKeypointName(name);
      if (!isRequiredKey(key)) {
        return;
      }
      const { x, y, confidence } = parseKeypointValue(entry);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return;
      }
      points[key] = { x, y };
      if (Number.isFinite(confidence)) {
        confidences.push(confidence);
      }
    });
  } else if (typeof rawKeypoints === "object") {
    Object.entries(rawKeypoints).forEach(([name, value]) => {
      const key = mapKeypointName(name);
      if (!isRequiredKey(key)) {
        return;
      }
      const { x, y, confidence } = parseKeypointValue(value);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return;
      }
      points[key] = { x, y };
      if (Number.isFinite(confidence)) {
        confidences.push(confidence);
      }
    });
  }

  if (!areLandmarksValid(points)) {
    return null;
  }

  const fallbackConfidence = clamp(best.confidence ?? 0.6, 0, 1);
  const confidence =
    confidences.length > 0 ? average(confidences) : fallbackConfidence;

  return { points, confidence };
}

function parseKeypointValue(value) {
  if (Array.isArray(value)) {
    return {
      x: value[0],
      y: value[1],
      confidence: value[2],
    };
  }
  if (value && typeof value === "object") {
    return {
      x: value.x ?? value[0],
      y: value.y ?? value[1],
      confidence: value.confidence ?? value.score ?? value[2],
    };
  }
  return { x: null, y: null, confidence: null };
}

function mapKeypointName(name) {
  const normalized = normalizeKeypointName(name);
  if (CLOUD_KEY_ALIASES[normalized]) {
    return CLOUD_KEY_ALIASES[normalized];
  }
  const match = CLOUD_REQUIRED_KEYS.find(
    (key) => normalizeKeypointName(key) === normalized
  );
  return match || name;
}

function normalizeKeypointName(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function isRequiredKey(key) {
  return CLOUD_REQUIRED_KEYS.includes(key);
}

function average(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function circleEdgeCoverage(edgeMat, x, y, r) {
  const samples = 48;
  let hits = 0;
  for (let i = 0; i < samples; i += 1) {
    const theta = (Math.PI * 2 * i) / samples;
    const px = Math.round(x + r * Math.cos(theta));
    const py = Math.round(y + r * Math.sin(theta));
    if (px < 0 || py < 0 || px >= edgeMat.cols || py >= edgeMat.rows) {
      continue;
    }
    if (edgeMat.ucharPtr(py, px)[0] > 0) {
      hits += 1;
    }
  }
  return hits / samples;
}

function renderOverlay() {
  if (!state.image) {
    return;
  }
  state.ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
  state.ctx.drawImage(
    state.image,
    0,
    0,
    elements.canvas.width,
    elements.canvas.height
  );

  if (state.coin.center && state.coin.radiusPx) {
    drawCircle(state.coin.center, state.coin.radiusPx, "#1c9bff");
    drawPoint(state.coin.center, "#1c9bff", "Coin");
  }

  drawLandmark(state.landmarks.indexBase, "#2ecc71", "2D base");
  drawLandmark(state.landmarks.indexTip, "#27ae60", "2D tip");
  drawLandmark(state.landmarks.ringBase, "#9b59b6", "4D base");
  drawLandmark(state.landmarks.ringTip, "#8e44ad", "4D tip");
}

function drawCircle(center, radius, color) {
  state.ctx.beginPath();
  state.ctx.strokeStyle = color;
  state.ctx.lineWidth = 2;
  state.ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  state.ctx.stroke();
}

function drawLandmark(point, color, label) {
  if (!point) {
    return;
  }
  drawPoint(point, color, label);
}

function drawPoint(point, color, label) {
  state.ctx.beginPath();
  state.ctx.fillStyle = color;
  state.ctx.strokeStyle = "#ffffff";
  state.ctx.lineWidth = 2;
  state.ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
  state.ctx.fill();
  state.ctx.stroke();

  if (label) {
    state.ctx.font = "12px sans-serif";
    state.ctx.fillStyle = "#1d1f26";
    state.ctx.fillText(label, point.x + 8, point.y - 8);
  }
}

function updateOutputs() {
  const lengths = computeMeasurements();
  if (!lengths) {
    elements.length2d.textContent = "—";
    elements.length4d.textContent = "—";
    elements.ratio.textContent = "—";
    elements.confidence.textContent = "—";
    return;
  }
  elements.length2d.textContent = `${lengths.length2dCm.toFixed(2)} cm`;
  elements.length4d.textContent = `${lengths.length4dCm.toFixed(2)} cm`;
  elements.ratio.textContent = lengths.ratio.toFixed(3);
  elements.confidence.textContent = `${Math.round(
    lengths.confidence * 100
  )}%`;
}

function computeMeasurements() {
  const { indexBase, indexTip, ringBase, ringTip } = state.landmarks;
  const { radiusPx, diameterCm } = state.coin;

  if (!indexBase || !indexTip || !ringBase || !ringTip || !radiusPx) {
    return null;
  }
  const cmPerPx = diameterCm / (2 * radiusPx);
  const length2dCm = distance(indexBase, indexTip) * cmPerPx;
  const length4dCm = distance(ringBase, ringTip) * cmPerPx;
  const ratio = length2dCm / length4dCm;

  const coinConfidence = clamp(state.coin.confidence ?? 0, 0, 1);
  const landmarkConfidence = clamp(state.landmarks.confidence ?? 0, 0, 1);
  const confidence = Math.min(coinConfidence, landmarkConfidence);

  return {
    length2dCm,
    length4dCm,
    ratio,
    confidence,
  };
}

function labelForKey(key) {
  const match = LANDMARK_ORDER.find((item) => item.key === key);
  return match ? match.label : key;
}

function areLandmarksValid(landmarks) {
  return (
    isPoint(landmarks.indexBase) &&
    isPoint(landmarks.indexTip) &&
    isPoint(landmarks.ringBase) &&
    isPoint(landmarks.ringTip)
  );
}

function isPoint(point) {
  return (
    point &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.y >= 0
  );
}

function getCanvasPoint(event) {
  const rect = elements.canvas.getBoundingClientRect();
  const scaleX = elements.canvas.width / rect.width;
  const scaleY = elements.canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function setStatus(message) {
  elements.status.textContent = message;
}
