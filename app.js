const cameraButton = document.querySelector(".camera-button");
const cameraDialog = document.querySelector(".camera-dialog");
const closeButton = document.querySelector(".close-button");
const cameraVideo = document.querySelector(".camera-video");
const cameraCanvas = document.querySelector(".camera-canvas");
const cameraStatus = document.querySelector(".camera-status");
const folderButton = document.querySelector(".folder-button");
const captureButton = document.querySelector(".capture-button");
const retakeButton = document.querySelector(".retake-button");
const cameraSoftCopy = document.querySelector(".camera-soft-copy");
const cameraOcrOutput = document.querySelector(".camera-ocr-output");
const cameraOutputSizeButton = document.querySelector(".camera-soft-copy .output-size-button");
const cameraCopyButton = document.querySelector(".camera-copy-button");
const cameraShareButton = document.querySelector(".camera-share-button");
const formatButtons = Array.from(document.querySelectorAll(".format-button"));
const savedPicturesButton = document.querySelector(".saved-pictures-button");
const galleryDialog = document.querySelector(".gallery-dialog");
const galleryCloseButton = document.querySelector(".gallery-close-button");
const galleryFolderButton = document.querySelector(".gallery-folder-button");
const galleryImageInput = document.querySelector(".gallery-image-input");
const galleryStatus = document.querySelector(".gallery-status");
const pictureGallery = document.querySelector(".picture-gallery");
const handwritingButton = document.querySelector(".handwriting-trainer-button");
const handwritingDialog = document.querySelector(".handwriting-dialog");
const handwritingCloseButton = document.querySelector(".handwriting-close-button");
const handwritingStatus = document.querySelector(".handwriting-status");
const handwritingLetterSelect = document.querySelector(".handwriting-letter-select");
const handwritingClearButton = document.querySelector(".handwriting-clear-button");
const handwritingSaveButton = document.querySelector(".handwriting-save-button");
const handwritingCanvas = document.querySelector(".handwriting-canvas");
const handwritingRecognizeButton = document.querySelector(".handwriting-recognize-button");
const handwritingClearAllButton = document.querySelector(".handwriting-clear-all-button");
const handwritingLetterGrid = document.querySelector(".handwriting-letter-grid");
const helpButton = document.querySelector(".help-button");
const helpDialog = document.querySelector(".help-dialog");
const helpCloseButton = document.querySelector(".help-close-button");

const canChooseFolder = "showDirectoryPicker" in window;
let cameraStream;
let pictureDirectory;
let galleryDirectory;
let galleryObjectUrls = [];
let ocrWorkerPromise;
let handwritingTrainingReady = Promise.resolve();

function setStatus(message) {
  cameraStatus.textContent = message;
}

function setOutputSize(output, button, expanded) {
  output.classList.toggle("is-maximized", expanded);
  button.textContent = expanded ? "Minimize text" : "Maximize text";
  button.setAttribute("aria-expanded", String(expanded));
}

function applyTextFormat(text, formatName) {
  if (!text || text.startsWith("No readable text")) {
    return text;
  }

  switch (formatName) {
    case "uppercase":
      return text.toUpperCase();
    case "lowercase":
      return text.toLowerCase();
    case "title":
      return text.toLowerCase().replace(/\b\w+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
    case "sentence":
      return text.toLowerCase().replace(/(^\s*[a-z]|[.!?]\s+[a-z])/g, (match) => match.toUpperCase());
    case "original":
    default:
      return text;
  }
}

function updateActiveFormatButton(selectedFormat) {
  formatButtons.forEach((button) => {
    const isActive = button.dataset.format === selectedFormat;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

let currentCameraFormat = "original";

function resetCameraSoftCopy() {
  cameraSoftCopy.hidden = true;
  cameraOcrOutput.value = "";
  setOutputSize(cameraOcrOutput, cameraOutputSizeButton, false);
  cameraCopyButton.hidden = true;
  cameraShareButton.hidden = true;
  currentCameraFormat = "original";
  updateActiveFormatButton(currentCameraFormat);
}

async function prepareImageForTextRecognition(blob) {
  const image = await createImageBitmap(blob);
  const scale = Math.min(2, 2400 / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    image.close();
    throw new Error("Image processing is unavailable in this browser.");
  }
  context.drawImage(image, 0, 0, width, height);
  image.close();

  const imageData = context.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  for (let index = 0; index < pixels.length; index += 4) {
    const gray = Math.round(
      pixels[index] * 0.299
      + pixels[index + 1] * 0.587
      + pixels[index + 2] * 0.114,
    );
    const contrast = Math.max(0, Math.min(255, (gray - 128) * 1.25 + 128));
    pixels[index] = contrast;
    pixels[index + 1] = contrast;
    pixels[index + 2] = contrast;
  }
  context.putImageData(imageData, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob((processedBlob) => {
      if (processedBlob) {
        resolve(processedBlob);
      } else {
        reject(new Error("The picture could not be prepared for text recognition."));
      }
    }, "image/png");
  });
}

function openSettingsDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("light-speed-settings", 2);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("settings")) {
        database.createObjectStore("settings");
      }
      if (!database.objectStoreNames.contains("pictures")) {
        database.createObjectStore("pictures");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readSavedDirectory() {
  const database = await openSettingsDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction("settings").objectStore("settings").get("picture-directory");
    request.onsuccess = () => {
      database.close();
      resolve(request.result);
    };
    request.onerror = () => {
      database.close();
      reject(request.error);
    };
  });
}

async function rememberDirectory(directory) {
  const database = await openSettingsDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("settings", "readwrite");
    transaction.objectStore("settings").put(directory, "picture-directory");
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

async function storePictureInGallery(blob, filename) {
  const database = await openSettingsDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("pictures", "readwrite");
    transaction.objectStore("pictures").put({
      filename,
      blob,
      createdAt: Date.now(),
    }, filename);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

async function getGalleryPictures() {
  const database = await openSettingsDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction("pictures").objectStore("pictures").getAll();
    request.onsuccess = () => {
      database.close();
      resolve(request.result.sort((first, second) => second.createdAt - first.createdAt));
    };
    request.onerror = () => {
      database.close();
      reject(request.error);
    };
  });
}

async function deleteGalleryPicture(filename) {
  const database = await openSettingsDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("pictures", "readwrite");
    transaction.objectStore("pictures").delete(filename);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error("The picture could not be deleted."));
    };
  });
}

function isImageFile(name) {
  return /\.(png|jpe?g|gif|webp|bmp|heic|heif|avif|ico|tiff?|svg|jxl)$/i.test(name);
}

async function loadDirectoryPictures(directoryHandle) {
  if (!directoryHandle || !directoryHandle.entries) {
    return [];
  }

  const entries = [];
  for await (const entry of directoryHandle.entries()) {
    const [name, handle] = entry;
    if (handle.kind === "file") {
      const file = await handle.getFile();
      if (isImageFile(name) || file.type.startsWith("image/")) {
        entries.push({
          filename: name,
          blob: file,
          createdAt: file.lastModified || 0,
        });
      }
    }
  }

  return entries.sort((first, second) => second.createdAt - first.createdAt);
}

async function showSavedPictures() {
  galleryObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  galleryObjectUrls = [];
  pictureGallery.replaceChildren();
  galleryStatus.textContent = "Loading saved pictures…";
  if (!galleryDialog.open) {
    galleryDialog.showModal();
  }

  try {
    const pictures = await getGalleryPictures();
    const directoryHandle = canChooseFolder ? galleryDirectory || pictureDirectory : undefined;
    const directoryPictures = directoryHandle
      ? await loadDirectoryPictures(directoryHandle)
      : [];

    const combinedPictures = [
      ...pictures.map((picture) => ({ ...picture, source: "gallery" })),
      ...directoryPictures
        .filter((directoryPicture) => !pictures.some(({ filename }) => filename === directoryPicture.filename))
        .map((picture) => ({ ...picture, source: "directory", directoryHandle })),
    ];

    galleryStatus.textContent = combinedPictures.length
      ? `${combinedPictures.length} picture${combinedPictures.length === 1 ? "" : "s"} ready to view.`
      : "No pictures saved yet. Take a picture with the camera or open a folder with existing images.";

    if (!combinedPictures.length) {
      const softCopyCard = document.createElement("article");
      softCopyCard.className = "soft-copy-preview";
      const softCopyImage = document.createElement("img");
      softCopyImage.src = "light-speed-icon.svg";
      softCopyImage.alt = "Light Speed soft-copy icon";
      const softCopyLabel = document.createElement("p");
      softCopyLabel.textContent = "Soft-copy icon";
      softCopyCard.append(softCopyImage, softCopyLabel);
      pictureGallery.append(softCopyCard);
      return;
    }

    combinedPictures.forEach(({ filename, blob, source, directoryHandle: pictureDirectoryHandle }) => {
      const card = document.createElement("article");
      card.className = "saved-picture";
      const image = document.createElement("img");
      image.src = blob instanceof Blob ? URL.createObjectURL(blob) : blob;
      image.alt = filename;
      galleryObjectUrls.push(image.src);
      const name = document.createElement("p");
      name.textContent = filename;
      const convertButton = document.createElement("button");
      convertButton.className = "gallery-convert-button";
      convertButton.type = "button";
      convertButton.textContent = "Convert to soft copy";
      const output = document.createElement("textarea");
      output.className = "gallery-ocr-output";
      output.readOnly = true;
      output.placeholder = "Converted text will appear here.";
      output.hidden = true;
      const outputSizeButton = document.createElement("button");
      outputSizeButton.className = "output-size-button";
      outputSizeButton.type = "button";
      outputSizeButton.textContent = "Maximize text";
      outputSizeButton.setAttribute("aria-expanded", "false");
      outputSizeButton.hidden = true;
      outputSizeButton.addEventListener("click", () => {
        setOutputSize(output, outputSizeButton, !output.classList.contains("is-maximized"));
      });
      const formatGroup = document.createElement("div");
      formatGroup.className = "text-format-controls";
      formatGroup.hidden = true;
      const outputFormats = ["original", "uppercase", "lowercase", "title", "sentence"];
      const formatMap = new Map();

      outputFormats.forEach((formatName) => {
        const formatButton = document.createElement("button");
        formatButton.type = "button";
        formatButton.className = `format-button${formatName === "original" ? " is-active" : ""}`;
        formatButton.dataset.format = formatName;
        formatButton.dataset.outputId = filename;
        formatButton.textContent = formatName === "original" ? "Original" : formatName === "uppercase" ? "UPPERCASE" : formatName === "lowercase" ? "lowercase" : formatName === "title" ? "Title Case" : "Sentence case";
        formatButton.setAttribute("aria-pressed", String(formatName === "original"));
        formatMap.set(formatName, formatButton);
        formatGroup.append(formatButton);

        formatButton.addEventListener("click", () => {
          formatMap.forEach((button) => {
            const active = button === formatButton;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", String(active));
          });

          if (output.dataset.originalText) {
            output.value = applyTextFormat(output.dataset.originalText, formatName);
          }
        });
      });

      const copyButton = document.createElement("button");
      copyButton.className = "gallery-copy-button";
      copyButton.type = "button";
      copyButton.textContent = "Copy text";
      copyButton.hidden = true;
      const shareButton = document.createElement("button");
      shareButton.className = "gallery-share-button";
      shareButton.type = "button";
      shareButton.textContent = "Share text";
      shareButton.setAttribute("aria-label", `Share converted text from ${filename}`);
      shareButton.hidden = true;
      const deleteButton = document.createElement("button");
      deleteButton.className = "gallery-delete-button";
      deleteButton.type = "button";
      deleteButton.textContent = "Delete picture";
      deleteButton.setAttribute("aria-label", `Delete ${filename}`);
      deleteButton.addEventListener("click", async () => {
        if (!window.confirm(`Permanently delete "${filename}"?`)) {
          return;
        }

        deleteButton.disabled = true;
        deleteButton.textContent = "Deleting…";
        try {
          if (source === "directory") {
            const permission = await pictureDirectoryHandle.requestPermission({ mode: "readwrite" });
            if (permission !== "granted") {
              throw new Error("Write permission was not granted.");
            }
            await pictureDirectoryHandle.removeEntry(filename);
          } else {
            await deleteGalleryPicture(filename);
          }

          await showSavedPictures();
          galleryStatus.textContent = `"${filename}" was deleted.`;
        } catch (error) {
          galleryStatus.textContent = `Could not delete "${filename}": ${error.message}`;
          deleteButton.disabled = false;
          deleteButton.textContent = "Delete picture";
        }
      });
      convertButton.addEventListener("click", async () => {
        convertButton.disabled = true;
        output.hidden = false;
        outputSizeButton.hidden = false;
        formatGroup.hidden = false;
        output.value = "Reading the picture...";
        copyButton.hidden = true;
        shareButton.hidden = true;

        try {
          const conversion = await convertImageToSoftCopy(blob);
          output.dataset.originalText = conversion.text;
          output.value = applyTextFormat(conversion.text, "original");
          copyButton.hidden = !conversion.text || conversion.text.startsWith("No readable text");
          shareButton.hidden = copyButton.hidden;
          galleryStatus.textContent = conversion.personalizationError
            ? `Converted "${filename}" with standard OCR. Handwriting samples could not be applied: ${conversion.personalizationError}`
            : conversion.personalizedCharacters
              ? `Converted "${filename}" using your handwriting samples for ${conversion.personalizedCharacters} character${conversion.personalizedCharacters === 1 ? "" : "s"}.`
              : conversion.trainedCharacters
                ? `Converted "${filename}" with standard OCR. No clear matches for your handwriting samples were found.`
                : `Converted "${filename}" to a soft copy.`;
        } catch (error) {
          output.value = `Could not convert the picture: ${error.message}`;
          galleryStatus.textContent = `Could not convert "${filename}": ${error.message}`;
        } finally {
          convertButton.disabled = false;
        }
      });
      copyButton.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(output.value);
          galleryStatus.textContent = `Text from "${filename}" copied to the clipboard.`;
        } catch {
          galleryStatus.textContent = `Clipboard access was blocked. Select and copy the text manually.`;
        }
      });
      shareButton.addEventListener("click", async () => {
        try {
          const result = await shareOrDownloadText(output.value, filename);
          galleryStatus.textContent = result.fallbackError
            ? `Could not open the share menu: ${result.fallbackError}. Downloaded the converted text as a .txt file instead.`
            : result.method === "share"
              ? `Shared converted text from "${filename}".`
              : `Downloaded converted text from "${filename}" as a .txt file.`;
        } catch (error) {
          galleryStatus.textContent = error.name === "AbortError"
            ? "Sharing was cancelled."
            : `Could not share or download text from "${filename}": ${error.message}`;
        }
      });
      card.append(image, name, convertButton, formatGroup, outputSizeButton, output, copyButton, shareButton, deleteButton);
      pictureGallery.append(card);
    });
  } catch (error) {
    galleryStatus.textContent = `Could not load saved pictures: ${error.message}`;
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = undefined;
  }
  cameraVideo.srcObject = null;
}

const handwritingTrainingLibrary = {};
const handwritingSampleSize = 32;
const handwritingStrokeColor = "#111111";
const handwritingBackgroundColor = "#ffffff";
const handwritingSupportedCharacters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?;:'\"()-/";

async function storeHandwritingTrainingLibrary(library = handwritingTrainingLibrary) {
  const database = await openSettingsDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("settings", "readwrite");
    transaction.objectStore("settings").put(
      structuredClone(library),
      "handwriting-training",
    );
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error("Handwriting samples could not be saved."));
    };
  });
}

async function loadHandwritingTrainingLibrary() {
  const database = await openSettingsDatabase();
  const savedLibrary = await new Promise((resolve, reject) => {
    const request = database.transaction("settings").objectStore("settings").get("handwriting-training");
    request.onsuccess = () => {
      database.close();
      resolve(request.result || {});
    };
    request.onerror = () => {
      database.close();
      reject(request.error);
    };
  });

  Object.entries(savedLibrary).forEach(([letter, samples]) => {
    if (
      handwritingSupportedCharacters.includes(letter)
      && Array.isArray(samples)
      && samples.every((sample) =>
        Array.isArray(sample)
        && sample.length === handwritingSampleSize * handwritingSampleSize
        && sample.every((pixel) => pixel === 0 || pixel === 1)
      )
    ) {
      handwritingTrainingLibrary[letter] = samples;
    }
  });
  renderHandwritingLibrary();
}

function getHandwritingContext() {
  return handwritingCanvas.getContext("2d");
}

function clearHandwritingCanvas() {
  const context = getHandwritingContext();
  context.clearRect(0, 0, handwritingCanvas.width, handwritingCanvas.height);
  context.fillStyle = handwritingBackgroundColor;
  context.fillRect(0, 0, handwritingCanvas.width, handwritingCanvas.height);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = 16;
  context.strokeStyle = handwritingStrokeColor;
}

function getCanvasPoint(event) {
  const rect = handwritingCanvas.getBoundingClientRect();
  const scaleX = handwritingCanvas.width / rect.width;
  const scaleY = handwritingCanvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function drawHandwritingStroke(from, to) {
  const context = getHandwritingContext();
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
}

function createHandwritingBitmap() {
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = handwritingSampleSize;
  tempCanvas.height = handwritingSampleSize;
  const tempContext = tempCanvas.getContext("2d");
  tempContext.fillStyle = handwritingBackgroundColor;
  tempContext.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
  tempContext.drawImage(handwritingCanvas, 0, 0, tempCanvas.width, tempCanvas.height);

  const imageData = tempContext.getImageData(0, 0, tempCanvas.width, tempCanvas.height).data;
  const bitmap = [];
  for (let index = 0; index < imageData.length; index += 4) {
    const gray = (imageData[index] + imageData[index + 1] + imageData[index + 2]) / 3;
    bitmap.push(gray < 245 ? 1 : 0);
  }
  return normalizeHandwritingBitmap(bitmap);
}

function normalizeHandwritingBitmap(bitmap) {
  let left = handwritingSampleSize;
  let top = handwritingSampleSize;
  let right = -1;
  let bottom = -1;

  bitmap.forEach((pixel, index) => {
    if (!pixel) {
      return;
    }
    const x = index % handwritingSampleSize;
    const y = Math.floor(index / handwritingSampleSize);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  });

  if (right < left || bottom < top) {
    return Array(handwritingSampleSize * handwritingSampleSize).fill(0);
  }

  const padding = 3;
  const scale = Math.min(
    (handwritingSampleSize - padding * 2) / (right - left + 1),
    (handwritingSampleSize - padding * 2) / (bottom - top + 1),
  );
  const width = Math.max(1, Math.round((right - left + 1) * scale));
  const height = Math.max(1, Math.round((bottom - top + 1) * scale));
  const offsetX = Math.floor((handwritingSampleSize - width) / 2);
  const offsetY = Math.floor((handwritingSampleSize - height) / 2);
  const normalized = Array(handwritingSampleSize * handwritingSampleSize).fill(0);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = left + Math.min(right - left, Math.floor(x / scale));
      const sourceY = top + Math.min(bottom - top, Math.floor(y / scale));
      if (bitmap[sourceY * handwritingSampleSize + sourceX]) {
        normalized[(offsetY + y) * handwritingSampleSize + offsetX + x] = 1;
      }
    }
  }

  return normalized;
}

function compareHandwritingSamples(currentSample, savedSample) {
  let mismatch = 0;
  for (let index = 0; index < currentSample.length; index += 1) {
    if (currentSample[index] !== savedSample[index]) {
      mismatch += 1;
    }
  }
  return mismatch;
}

function renderHandwritingLibrary() {
  handwritingLetterGrid.replaceChildren();
  const letters = Object.keys(handwritingTrainingLibrary).sort();

  if (!letters.length) {
    const emptyState = document.createElement("p");
    emptyState.className = "handwriting-empty-state";
    emptyState.textContent = "No saved samples yet.";
    handwritingLetterGrid.append(emptyState);
    return;
  }

  letters.forEach((letter) => {
    const sampleCount = handwritingTrainingLibrary[letter].length;
    const card = document.createElement("div");
    card.className = "handwriting-letter-card";

    const preview = document.createElement("canvas");
    preview.width = 56;
    preview.height = 56;
    const previewContext = preview.getContext("2d");
    previewContext.fillStyle = handwritingBackgroundColor;
    previewContext.fillRect(0, 0, preview.width, preview.height);
    const lastSample = handwritingTrainingLibrary[letter][sampleCount - 1];
    const sampleImage = document.createElement("canvas");
    sampleImage.width = handwritingSampleSize;
    sampleImage.height = handwritingSampleSize;
    const sampleContext = sampleImage.getContext("2d");
    sampleContext.fillStyle = handwritingBackgroundColor;
    sampleContext.fillRect(0, 0, sampleImage.width, sampleImage.height);

    lastSample.forEach((pixel, index) => {
      if (!pixel) {
        return;
      }
      const x = index % handwritingSampleSize;
      const y = Math.floor(index / handwritingSampleSize);
      sampleContext.fillStyle = handwritingStrokeColor;
      sampleContext.fillRect(x, y, 1, 1);
    });

    previewContext.drawImage(sampleImage, 0, 0, preview.width, preview.height);

    const label = document.createElement("span");
    label.textContent = letter;

    const meta = document.createElement("small");
    meta.textContent = `${sampleCount} sample${sampleCount === 1 ? "" : "s"}`;

    card.append(preview, label, meta);
    handwritingLetterGrid.append(card);
  });
}

async function saveHandwritingSample() {
  await handwritingTrainingReady;
  const selectedLetter = handwritingLetterSelect.value;
  const sample = createHandwritingBitmap();
  const hasInk = sample.some((pixel) => pixel === 1);

  if (!hasInk) {
    handwritingStatus.textContent = "Draw the selected character before saving a sample.";
    return;
  }

  if (!handwritingTrainingLibrary[selectedLetter]) {
    handwritingTrainingLibrary[selectedLetter] = [];
  }

  handwritingTrainingLibrary[selectedLetter].push(sample);
  try {
    await storeHandwritingTrainingLibrary();
  } catch (error) {
    handwritingTrainingLibrary[selectedLetter].pop();
    if (!handwritingTrainingLibrary[selectedLetter].length) {
      delete handwritingTrainingLibrary[selectedLetter];
    }
    handwritingStatus.textContent = `Could not save the handwriting sample: ${error.message}`;
    return;
  }
  renderHandwritingLibrary();
  handwritingStatus.textContent = `Saved "${selectedLetter}" sample ${handwritingTrainingLibrary[selectedLetter].length}.`;
  clearHandwritingCanvas();
}

function recognizeHandwriting() {
  const currentSample = createHandwritingBitmap();
  const hasInk = currentSample.some((pixel) => pixel === 1);

  if (!hasInk) {
    handwritingStatus.textContent = "Draw a character in the box and then test recognition.";
    return null;
  }

  if (!Object.keys(handwritingTrainingLibrary).length) {
    handwritingStatus.textContent = "Save at least one character sample before testing recognition.";
    return null;
  }

  let bestLetter = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  Object.entries(handwritingTrainingLibrary).forEach(([letter, samples]) => {
    const averageDistance = samples.reduce((sum, sample) => sum + compareHandwritingSamples(currentSample, sample), 0) / samples.length;
    if (averageDistance < bestDistance) {
      bestDistance = averageDistance;
      bestLetter = letter;
    }
  });

  handwritingStatus.textContent = `Best match: ${bestLetter} (${Math.max(0, Math.round((1 - bestDistance / currentSample.length) * 100))}% similarity)`;
  return bestLetter;
}

async function convertImageToSoftCopy(blob) {
  await handwritingTrainingReady;
  if (!blob || !window.Tesseract) {
    throw new Error("Text recognition is unavailable in this browser.");
  }

  const preparedImage = await prepareImageForTextRecognition(blob);
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = Tesseract.createWorker("eng", 1, {
      workerPath: new URL("vendor/tesseract/worker.min.js", document.baseURI).href,
      corePath: new URL("vendor/tesseract/tesseract-core-lstm.wasm.js", document.baseURI).href,
      langPath: new URL("vendor/tesseract/lang-data", document.baseURI).href,
      gzip: true,
      logger: () => {},
    }).catch((error) => {
      ocrWorkerPromise = undefined;
      throw error;
    });
  }
  const worker = await ocrWorkerPromise;
  const result = await worker.recognize(preparedImage);

  const text = (result.data.text || "").trim();
  if (!text) {
    return {
      text: "No readable text was found. Try a sharp, well-lit photo with the writing filling the frame.",
      personalizedCharacters: 0,
      trainedCharacters: Object.keys(handwritingTrainingLibrary).length,
    };
  }

  const trainedCharacters = Object.keys(handwritingTrainingLibrary).length;
  if (!trainedCharacters) {
    return { text, personalizedCharacters: 0, trainedCharacters };
  }

  try {
    const personalizedCharacters = await applyHandwritingSamplesToOcr(
      preparedImage,
      result.data.words || [],
      text,
    );
    return { text: personalizedCharacters.text, personalizedCharacters: personalizedCharacters.count, trainedCharacters };
  } catch (error) {
    return { text, personalizedCharacters: 0, trainedCharacters, personalizationError: error.message };
  }
}

function classifyHandwritingBitmap(bitmap) {
  const matches = Object.entries(handwritingTrainingLibrary).map(([letter, samples]) => ({
    letter,
    distance: samples.reduce(
      (sum, sample) => sum + compareHandwritingSamples(bitmap, sample),
      0,
    ) / samples.length,
  })).sort((first, second) => first.distance - second.distance);

  const best = matches[0];
  const nextDistance = matches[1]?.distance ?? Number.POSITIVE_INFINITY;
  const maxDistance = bitmap.length * 0.28;
  const minSeparation = bitmap.length * 0.04;
  if (!best || best.distance > maxDistance || nextDistance - best.distance < minSeparation) {
    return null;
  }
  return best.letter;
}

function getWordCharacterSegments(imageData, boundingBox) {
  const { width, height, data } = imageData;
  const left = Math.max(0, Math.floor(boundingBox.x0));
  const top = Math.max(0, Math.floor(boundingBox.y0));
  const right = Math.min(width, Math.ceil(boundingBox.x1));
  const bottom = Math.min(height, Math.ceil(boundingBox.y1));
  if (right <= left || bottom <= top) {
    return [];
  }

  const activeColumns = [];
  for (let x = left; x < right; x += 1) {
    let hasInk = false;
    for (let y = top; y < bottom; y += 1) {
      const pixelIndex = (y * width + x) * 4;
      if ((data[pixelIndex] + data[pixelIndex + 1] + data[pixelIndex + 2]) / 3 < 170) {
        hasInk = true;
        break;
      }
    }
    activeColumns.push(hasInk);
  }

  const segments = [];
  let segmentStart = -1;
  let lastActive = -1;
  activeColumns.forEach((active, offset) => {
    if (active) {
      if (segmentStart < 0) {
        segmentStart = offset;
      }
      if (lastActive >= 0 && offset - lastActive > 2) {
        segments.push({ x0: segmentStart + left, x1: lastActive + left + 1, y0: top, y1: bottom });
        segmentStart = offset;
      }
      lastActive = offset;
    }
  });
  if (segmentStart >= 0) {
    segments.push({ x0: segmentStart + left, x1: lastActive + left + 1, y0: top, y1: bottom });
  }

  return segments.map((segment) => {
    let glyphTop = bottom;
    let glyphBottom = top;
    for (let x = segment.x0; x < segment.x1; x += 1) {
      for (let y = top; y < bottom; y += 1) {
        const pixelIndex = (y * width + x) * 4;
        if ((data[pixelIndex] + data[pixelIndex + 1] + data[pixelIndex + 2]) / 3 < 170) {
          glyphTop = Math.min(glyphTop, y);
          glyphBottom = Math.max(glyphBottom, y + 1);
        }
      }
    }
    return { ...segment, y0: glyphTop, y1: glyphBottom };
  }).filter((segment) => segment.y1 > segment.y0);
}

function createImageGlyphBitmap(imageData, segment) {
  const { width, data } = imageData;
  const rawBitmap = Array(handwritingSampleSize * handwritingSampleSize).fill(0);
  const glyphWidth = segment.x1 - segment.x0;
  const glyphHeight = segment.y1 - segment.y0;
  const scale = Math.min(
    (handwritingSampleSize - 6) / glyphWidth,
    (handwritingSampleSize - 6) / glyphHeight,
  );
  const targetWidth = Math.max(1, Math.round(glyphWidth * scale));
  const targetHeight = Math.max(1, Math.round(glyphHeight * scale));
  const offsetX = Math.floor((handwritingSampleSize - targetWidth) / 2);
  const offsetY = Math.floor((handwritingSampleSize - targetHeight) / 2);

  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = segment.x0 + Math.min(glyphWidth - 1, Math.floor(x / scale));
      const sourceY = segment.y0 + Math.min(glyphHeight - 1, Math.floor(y / scale));
      const pixelIndex = (sourceY * width + sourceX) * 4;
      const gray = (data[pixelIndex] + data[pixelIndex + 1] + data[pixelIndex + 2]) / 3;
      if (gray < 170) {
        rawBitmap[(offsetY + y) * handwritingSampleSize + offsetX + x] = 1;
      }
    }
  }
  return rawBitmap;
}

async function applyHandwritingSamplesToOcr(imageBlob, words, originalText) {
  const image = await createImageBitmap(imageBlob);
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    image.close();
    throw new Error("Image processing is unavailable in this browser.");
  }
  context.drawImage(image, 0, 0);
  image.close();
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const replacements = [];
  let searchFrom = 0;

  words.forEach((word) => {
    if (!/^[A-Za-z0-9.,!?;:'"()/-]+$/.test(word.text) || !word.bbox) {
      return;
    }
    const start = originalText.indexOf(word.text, searchFrom);
    if (start < 0) {
      return;
    }
    searchFrom = start + word.text.length;
    const segments = getWordCharacterSegments(imageData, word.bbox);
    if (segments.length !== word.text.length) {
      return;
    }

    const personalizedWord = Array.from(word.text).map((character, index) => {
      const glyphBitmap = createImageGlyphBitmap(imageData, segments[index]);
      const match = classifyHandwritingBitmap(glyphBitmap);
      if (!match) {
        return character;
      }
      return character === character.toUpperCase() ? match : match.toLowerCase();
    }).join("");

    if (personalizedWord !== word.text) {
      replacements.push({ start, end: start + word.text.length, text: personalizedWord });
    }
  });

  let correctedText = originalText;
  replacements.reverse().forEach(({ start, end, text }) => {
    correctedText = `${correctedText.slice(0, start)}${text}${correctedText.slice(end)}`;
  });
  return {
    text: correctedText,
    count: replacements.reduce((total, replacement) =>
      total + Array.from(replacement.text).filter((character, index) =>
        character !== originalText[replacement.start + index]
      ).length, 0),
  };
}

async function startCamera() {
  setStatus("Starting camera…");
  captureButton.disabled = true;
  cameraCanvas.hidden = true;
  cameraVideo.hidden = false;
  retakeButton.hidden = true;
  resetCameraSoftCopy();

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera access is unavailable. Open this page over HTTPS or from localhost.");
    }
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    cameraVideo.srcObject = cameraStream;
    await cameraVideo.play();
    captureButton.disabled = false;
    setStatus(canChooseFolder
      ? pictureDirectory
        ? "Camera ready. Pictures will be saved to your selected folder."
        : "Camera ready. Capture a picture and choose its save folder."
      : "Camera ready. Captured pictures will download to your browser's Downloads folder.");
  } catch (error) {
    stopCamera();
    setStatus(error.message || "Could not start the camera. Check camera permissions and try again.");
  }
}

cameraButton.addEventListener("click", async () => {
  cameraDialog.showModal();
  if (canChooseFolder) {
    try {
      pictureDirectory = await readSavedDirectory();
    } catch (error) {
      setStatus(`Could not load the saved picture folder: ${error.message}`);
    }
  }
  await startCamera();
});

closeButton.addEventListener("click", () => {
  cameraDialog.close();
});
cameraDialog.addEventListener("close", () => {
  stopCamera();
  resetCameraSoftCopy();
});
savedPicturesButton.addEventListener("click", showSavedPictures);
galleryCloseButton.addEventListener("click", () => galleryDialog.close());
cameraOutputSizeButton.addEventListener("click", () => {
  setOutputSize(cameraOcrOutput, cameraOutputSizeButton, !cameraOcrOutput.classList.contains("is-maximized"));
});
galleryImageInput.addEventListener("change", async () => {
  const selectedFiles = Array.from(galleryImageInput.files || []);
  galleryImageInput.value = "";
  if (!selectedFiles.length) {
    return;
  }

  const imageFiles = selectedFiles.filter((file) =>
    file.type.startsWith("image/") || isImageFile(file.name)
  );
  if (imageFiles.length !== selectedFiles.length) {
    galleryStatus.textContent = "Some selected files are not recognized as images and were skipped.";
    if (!imageFiles.length) {
      return;
    }
  }

  let addedCount = 0;
  for (const [index, file] of imageFiles.entries()) {
    const filename = `import-${Date.now()}-${index}-${file.name}`;
    try {
      await storePictureInGallery(file, filename);
      addedCount += 1;
    } catch (error) {
      galleryStatus.textContent = `Could not add "${file.name}": ${error.message}`;
    }
  }

  if (addedCount) {
    await showSavedPictures();
    galleryStatus.textContent = `${addedCount} image${addedCount === 1 ? "" : "s"} added. Use Convert to soft copy on a picture to extract its text.`;
  }
});
galleryDialog.addEventListener("close", () => {
  galleryObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  galleryObjectUrls = [];
});

galleryFolderButton.addEventListener("click", async () => {
  if (!canChooseFolder) {
    galleryStatus.textContent = "This browser does not support selecting folders from disk.";
    return;
  }

  try {
    galleryDirectory = await window.showDirectoryPicker({ id: "light-speed-gallery", mode: "readwrite" });
    if (galleryDirectory) {
      await rememberDirectory(galleryDirectory);
      pictureDirectory = galleryDirectory;
      galleryStatus.textContent = `Showing images from "${galleryDirectory.name}".`;
      await showSavedPictures();
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      galleryStatus.textContent = `Could not open the folder: ${error.message}`;
    }
  }
});

folderButton.addEventListener("click", async () => {
  if (!canChooseFolder) {
    setStatus("Your browser cannot write directly to a chosen folder. Pictures will download to Downloads.");
    return;
  }

  try {
    pictureDirectory = await window.showDirectoryPicker({ id: "light-speed-pictures", mode: "readwrite" });
    galleryDirectory = pictureDirectory;
    await rememberDirectory(pictureDirectory);
    setStatus(`Save folder set to "${pictureDirectory.name}".`);
  } catch (error) {
    if (error.name !== "AbortError") {
      setStatus(`Could not set the save folder: ${error.message}`);
    }
  }
});

function makePictureName() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `light-speed-${timestamp}.png`;
}

async function shareOrDownloadText(text, filename) {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: filename, text });
      return { method: "share" };
    } catch (error) {
      if (error.name === "AbortError") {
        throw error;
      }
      return {
        method: "download",
        fallbackError: error.message || "The share menu is unavailable",
        filename: downloadConvertedText(text, filename),
      };
    }
  }

  return { method: "download", filename: downloadConvertedText(text, filename) };
}

function downloadConvertedText(text, filename) {
  const baseName = filename
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "light-speed-text";
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${baseName}.txt`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return link.download;
}

function canvasToBlob() {
  return new Promise((resolve, reject) => {
    cameraCanvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("The picture could not be created."));
      }
    }, "image/png");
  });
}

async function savePicture(blob, filename) {
  if (canChooseFolder) {
    const permission = await pictureDirectory.requestPermission({ mode: "readwrite" });
    if (permission !== "granted") {
      setStatus("Folder access was not granted. Choose a folder again to save this picture.");
      return false;
    }
    const file = await pictureDirectory.getFileHandle(filename, { create: true });
    const writable = await file.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  return true;
}

captureButton.addEventListener("click", async () => {
  if (!cameraVideo.videoWidth || !cameraVideo.videoHeight) {
    setStatus("The camera is not ready yet. Please wait and try again.");
    return;
  }

  captureButton.disabled = true;
  cameraCanvas.width = cameraVideo.videoWidth;
  cameraCanvas.height = cameraVideo.videoHeight;
  cameraCanvas.getContext("2d").drawImage(cameraVideo, 0, 0);

  try {
    const blobRequest = canvasToBlob();
    const blob = await blobRequest;
    const filename = makePictureName();
    await storePictureInGallery(blob, filename);
    cameraVideo.hidden = true;
    cameraCanvas.hidden = false;
    retakeButton.hidden = false;
    cameraSoftCopy.hidden = false;
    cameraOcrOutput.value = "Recognizing text in the picture…";
    cameraCopyButton.hidden = true;
    setStatus("Picture saved. Recognizing text…");

    if (canChooseFolder && !pictureDirectory) {
      cameraStatus.textContent = `Picture saved in Saved pictures as "${filename}". Recognizing text…`;
    } else {
      try {
        const saved = await savePicture(blob, filename);
        if (saved) {
          cameraStatus.textContent = `Picture saved in Saved pictures and as "${filename}". Recognizing text…`;
        }
      } catch (error) {
        cameraStatus.textContent = `Picture is in Saved pictures, but could not be saved to the selected folder: ${error.message}. Recognizing text…`;
      }
    }

    try {
      const conversion = await convertImageToSoftCopy(blob);
      cameraOcrOutput.dataset.originalText = conversion.text;
      cameraOcrOutput.value = applyTextFormat(conversion.text, currentCameraFormat);
      cameraCopyButton.hidden = !conversion.text || conversion.text.startsWith("No readable text");
      cameraShareButton.hidden = cameraCopyButton.hidden;
      setStatus(conversion.text.startsWith("No readable text")
        ? "Picture saved. No text was recognized; try a closer, sharper photo."
        : conversion.personalizationError
          ? `Picture saved and converted with standard OCR. Handwriting samples could not be applied: ${conversion.personalizationError}`
          : conversion.personalizedCharacters
            ? `Picture saved and converted using your handwriting samples for ${conversion.personalizedCharacters} character${conversion.personalizedCharacters === 1 ? "" : "s"}.`
            : conversion.trainedCharacters
              ? "Picture saved and converted with standard OCR. No clear matches for your handwriting samples were found."
              : "Picture saved and converted to a soft copy.");
    } catch (error) {
      cameraOcrOutput.value = `Could not recognize text: ${error.message}`;
      setStatus("Picture saved, but text recognition failed. You can try converting it from Saved pictures.");
    }
  } catch (error) {
    setStatus(`Could not store the picture in Saved pictures: ${error.message}`);
  } finally {
    captureButton.disabled = false;
  }
});

cameraCopyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(cameraOcrOutput.value);
    setStatus("Extracted text copied to the clipboard.");
  } catch {
    setStatus("Clipboard access was blocked. You can still select and copy the text manually.");
  }
});

cameraShareButton.addEventListener("click", async () => {
  try {
    const result = await shareOrDownloadText(cameraOcrOutput.value, "light-speed-converted-text");
    setStatus(result.fallbackError
      ? `Could not open the share menu: ${result.fallbackError}. Downloaded the converted text as a .txt file instead.`
      : result.method === "share"
        ? "Shared converted text."
        : "Downloaded converted text as a .txt file.");
  } catch (error) {
    setStatus(error.name === "AbortError"
      ? "Sharing was cancelled."
      : `Could not share or download the converted text: ${error.message}`);
  }
});

formatButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const selectedFormat = button.dataset.format;
    currentCameraFormat = selectedFormat;
    updateActiveFormatButton(selectedFormat);

    if (cameraOcrOutput.value && !cameraOcrOutput.value.startsWith("Could not recognize text") && !cameraOcrOutput.value.startsWith("Recognizing text in the picture…")) {
      const originalText = cameraOcrOutput.dataset.originalText || cameraOcrOutput.value;
      cameraOcrOutput.value = applyTextFormat(originalText, selectedFormat);
    }
  });
});

cameraOcrOutput.dataset.originalText = "";

handwritingButton.addEventListener("click", () => {
  handwritingDialog.showModal();
  handwritingStatus.textContent = "Choose a letter, number, or punctuation mark, draw it in the box, and save the sample. Saved samples can help with clear characters when you convert a picture.";
  renderHandwritingLibrary();
});

helpButton.addEventListener("click", () => helpDialog.showModal());
helpCloseButton.addEventListener("click", () => helpDialog.close());

handwritingCloseButton.addEventListener("click", () => handwritingDialog.close());
handwritingDialog.addEventListener("close", () => {
  clearHandwritingCanvas();
  handwritingStatus.textContent = "Choose a letter, number, or punctuation mark, draw it in the box, and save the sample. Saved samples can help with clear characters when you convert a picture.";
});

handwritingClearButton.addEventListener("click", () => {
  clearHandwritingCanvas();
  handwritingStatus.textContent = "Canvas cleared. Draw a new character.";
});

handwritingSaveButton.addEventListener("click", saveHandwritingSample);
handwritingRecognizeButton.addEventListener("click", () => {
  recognizeHandwriting();
});

handwritingClearAllButton.addEventListener("click", async () => {
  await handwritingTrainingReady;
  try {
    await storeHandwritingTrainingLibrary({});
  } catch (error) {
    handwritingStatus.textContent = `Could not reset handwriting training: ${error.message}`;
    return;
  }
  Object.keys(handwritingTrainingLibrary).forEach((letter) => delete handwritingTrainingLibrary[letter]);
  renderHandwritingLibrary();
  clearHandwritingCanvas();
  handwritingStatus.textContent = "Training reset. Save new character samples to teach the handwriting reader.";
});

handwritingCanvas.addEventListener("pointerdown", (event) => {
  const point = getCanvasPoint(event);
  handwritingCanvas.setPointerCapture(event.pointerId);
  const context = getHandwritingContext();
  context.beginPath();
  context.moveTo(point.x, point.y);
  context.lineTo(point.x, point.y);
  context.stroke();
  handwritingCanvas.dataset.drawing = "true";
});

handwritingCanvas.addEventListener("pointermove", (event) => {
  if (handwritingCanvas.dataset.drawing !== "true") {
    return;
  }
  const point = getCanvasPoint(event);
  const context = getHandwritingContext();
  context.lineTo(point.x, point.y);
  context.stroke();
});

handwritingCanvas.addEventListener("pointerup", (event) => {
  handwritingCanvas.dataset.drawing = "false";
  if (event.pointerId !== undefined) {
    handwritingCanvas.releasePointerCapture?.(event.pointerId);
  }
});

handwritingCanvas.addEventListener("pointerleave", () => {
  handwritingCanvas.dataset.drawing = "false";
});

handwritingLetterSelect.addEventListener("change", () => {
  const selectedCharacter = handwritingLetterSelect.selectedOptions[0].textContent;
  handwritingStatus.textContent = `Selected character: ${selectedCharacter}. Draw it and save a sample.`;
});

retakeButton.addEventListener("click", () => {
  cameraCanvas.hidden = true;
  cameraVideo.hidden = false;
  retakeButton.hidden = true;
  resetCameraSoftCopy();
  setStatus("Camera ready. Take another picture when you’re ready.");
});

handwritingTrainingReady = loadHandwritingTrainingLibrary().catch((error) => {
  handwritingStatus.textContent = `Could not load saved handwriting samples: ${error.message}`;
});

folderButton.hidden = !canChooseFolder;
if (!canChooseFolder) {
  setStatus("Pictures will download to your browser's Downloads folder.");
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("./service-worker.js").catch((error) => {
    console.error("Could not enable offline app caching:", error);
  });
}

clearHandwritingCanvas();
renderHandwritingLibrary();
