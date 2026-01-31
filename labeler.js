"use strict";

const LANDMARK_ORDER = [
  { key: "indexBase", label: "Index base (Jupiter crease)" },
  { key: "indexTip", label: "Index tip" },
  { key: "ringBase", label: "Ring base (Apollo crease)" },
  { key: "ringTip", label: "Ring tip" },
];

const MAX_CANVAS_DIMENSION = 1400;

const state = {
  canvas: null,
  ctx: null,
  images: [],
  currentIndex: 0,
  queue: [],
  mode: null,
  landmarks: {},
  annotations: new Map(),
  transform: null,
};

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
  elements.imageInput = document.getElementById("imageInput");
  elements.imageSelect = document.getElementById("imageSelect");
  elements.progressSummary = document.getElementById("progressSummary");
  elements.startLabelingBtn = document.getElementById("startLabelingBtn");
  elements.clearPointsBtn = document.getElementById("clearPointsBtn");
  elements.saveAnnotationBtn = document.getElementById("saveAnnotationBtn");
  elements.downloadBtn = document.getElementById("downloadBtn");
  elements.prevBtn = document.getElementById("prevBtn");
  elements.nextBtn = document.getElementById("nextBtn");
  elements.status = document.getElementById("status");
  elements.canvasHint = document.getElementById("canvasHint");
  elements.canvas = document.getElementById("labelCanvas");

  state.canvas = elements.canvas;
  state.ctx = elements.canvas.getContext("2d");

  bindEvents();
  updateProgress();
});

function bindEvents() {
  elements.imageInput.addEventListener("change", handleImageUpload);
  elements.imageSelect.addEventListener("change", handleImageSelection);
  elements.startLabelingBtn.addEventListener("click", startLabeling);
  elements.clearPointsBtn.addEventListener("click", clearPoints);
  elements.saveAnnotationBtn.addEventListener("click", saveAnnotation);
  elements.downloadBtn.addEventListener("click", downloadAnnotations);
  elements.prevBtn.addEventListener("click", () => shiftImage(-1));
  elements.nextBtn.addEventListener("click", () => shiftImage(1));
  elements.canvas.addEventListener("click", handleCanvasClick);
}

async function handleImageUpload(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) {
    return;
  }

  const loaded = await Promise.all(files.map(loadImage));
  state.images = loaded;
  state.currentIndex = 0;
  state.annotations = new Map();
  state.landmarks = {};
  state.queue = [];
  state.mode = null;

  populateImageSelect();
  setCurrentImage(0);
  elements.canvasHint.style.display = "none";
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({
        file,
        name: file.name,
        image,
        width: image.width,
        height: image.height,
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to load ${file.name}`));
    };
    image.src = url;
  });
}

function populateImageSelect() {
  elements.imageSelect.innerHTML = "";
  state.images.forEach((item, index) => {
    const option = document.createElement("option");
    option.value = index;
    option.textContent = item.name;
    elements.imageSelect.appendChild(option);
  });
}

function handleImageSelection(event) {
  const index = Number.parseInt(event.target.value, 10);
  if (Number.isNaN(index)) {
    return;
  }
  setCurrentImage(index);
}

function setCurrentImage(index) {
  if (index < 0 || index >= state.images.length) {
    return;
  }
  state.currentIndex = index;
  elements.imageSelect.value = index.toString();

  const current = currentImage();
  const existing = state.annotations.get(current.name);
  state.landmarks = existing ? hydrateLandmarks(existing.landmarks) : {};
  state.queue = [];
  state.mode = null;

  drawImageToCanvas(current);
  updateProgress();
  setStatus(existing ? "Loaded saved annotation." : "Ready to label.");
}

function currentImage() {
  return state.images[state.currentIndex];
}

function drawImageToCanvas(item) {
  const scale = Math.min(
    1,
    MAX_CANVAS_DIMENSION / Math.max(item.width, item.height)
  );
  const width = Math.round(item.width * scale);
  const height = Math.round(item.height * scale);
  elements.canvas.width = width;
  elements.canvas.height = height;
  state.ctx.clearRect(0, 0, width, height);
  state.ctx.drawImage(item.image, 0, 0, width, height);
  state.transform = { scale, offsetX: 0, offsetY: 0 };
  renderOverlay();
}

function startLabeling() {
  if (!state.images.length) {
    setStatus("Upload images first.");
    return;
  }
  state.mode = "labeling";
  state.queue = LANDMARK_ORDER.map((item) => item.key);
  state.landmarks = {};
  setStatus(`Click ${labelForKey(state.queue[0])}.`);
  renderOverlay();
}

function clearPoints() {
  state.landmarks = {};
  state.queue = [];
  state.mode = null;
  setStatus("Cleared points.");
  renderOverlay();
}

function handleCanvasClick(event) {
  if (state.mode !== "labeling") {
    return;
  }
  const key = state.queue.shift();
  if (!key) {
    state.mode = null;
    return;
  }
  const point = getCanvasPoint(event);
  const current = currentImage();
  const originalPoint = canvasToOriginal(point, current);
  state.landmarks[key] = originalPoint;

  if (state.queue.length === 0) {
    state.mode = null;
    setStatus("All points captured. Click Save annotation.");
  } else {
    setStatus(`Click ${labelForKey(state.queue[0])}.`);
  }
  renderOverlay();
}

function saveAnnotation() {
  if (!state.images.length) {
    setStatus("Upload images first.");
    return;
  }
  const current = currentImage();
  if (!hasAllLandmarks(state.landmarks)) {
    setStatus("Missing points. Complete all landmarks first.");
    return;
  }
  const payload = {
    image: current.name,
    width: current.width,
    height: current.height,
    landmarks: exportLandmarks(state.landmarks),
  };
  state.annotations.set(current.name, payload);
  updateProgress();
  setStatus("Annotation saved.");
}

function downloadAnnotations() {
  if (state.annotations.size === 0) {
    setStatus("No annotations to export.");
    return;
  }
  const items = Array.from(state.annotations.values());
  const payload = {
    version: 1,
    createdAt: new Date().toISOString(),
    order: LANDMARK_ORDER.map((item) => item.key),
    items,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "handscan_annotations.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus("Downloaded annotations.");
}

function shiftImage(direction) {
  if (!state.images.length) {
    return;
  }
  let next = state.currentIndex + direction;
  next = Math.max(0, Math.min(state.images.length - 1, next));
  setCurrentImage(next);
}

function updateProgress() {
  const total = state.images.length;
  const labeled = state.annotations.size;
  elements.progressSummary.value = total
    ? `${labeled}/${total} labeled`
    : "0/0 labeled";
}

function renderOverlay() {
  const current = currentImage();
  if (!current) {
    return;
  }
  state.ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
  state.ctx.drawImage(
    current.image,
    0,
    0,
    elements.canvas.width,
    elements.canvas.height
  );

  Object.entries(state.landmarks).forEach(([key, point]) => {
    const canvasPoint = originalToCanvas(point);
    drawPoint(canvasPoint, "#2b5dff", labelForKey(key));
  });
}

function originalToCanvas(point) {
  return {
    x: point.x * state.transform.scale + state.transform.offsetX,
    y: point.y * state.transform.scale + state.transform.offsetY,
  };
}

function canvasToOriginal(point, current) {
  const scale = state.transform.scale;
  const x = (point.x - state.transform.offsetX) / scale;
  const y = (point.y - state.transform.offsetY) / scale;
  return {
    x: clamp(x, 0, current.width),
    y: clamp(y, 0, current.height),
  };
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

function drawPoint(point, color, label) {
  state.ctx.beginPath();
  state.ctx.fillStyle = color;
  state.ctx.strokeStyle = "#ffffff";
  state.ctx.lineWidth = 2;
  state.ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
  state.ctx.fill();
  state.ctx.stroke();

  state.ctx.font = "12px sans-serif";
  state.ctx.fillStyle = "#1d1f26";
  state.ctx.fillText(label, point.x + 8, point.y - 8);
}

function hasAllLandmarks(landmarks) {
  return LANDMARK_ORDER.every((item) => isPoint(landmarks[item.key]));
}

function labelForKey(key) {
  const match = LANDMARK_ORDER.find((item) => item.key === key);
  return match ? match.label : key;
}

function exportLandmarks(landmarks) {
  const output = {};
  LANDMARK_ORDER.forEach((item) => {
    const point = landmarks[item.key];
    output[item.key] = [round(point.x), round(point.y)];
  });
  return output;
}

function hydrateLandmarks(landmarks) {
  const output = {};
  LANDMARK_ORDER.forEach((item) => {
    const value = landmarks[item.key];
    if (value && value.length === 2) {
      output[item.key] = { x: value[0], y: value[1] };
    }
  });
  return output;
}

function isPoint(point) {
  return (
    point &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y)
  );
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function setStatus(message) {
  elements.status.textContent = message;
}
