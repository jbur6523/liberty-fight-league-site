const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Source-image coordinates; the crop always stays square and inside the photo.
export function squareCrop(width, height, zoom = 1, centerX = width / 2, centerY = height / 2) {
  const size = Math.min(width, height) / clamp(zoom, 1, 4);
  const x = clamp(centerX - size / 2, 0, width - size);
  const y = clamp(centerY - size / 2, 0, height - size);
  return { x, y, size, centerX: x + size / 2, centerY: y + size / 2 };
}

export async function cropFighterPhoto(file) {
  if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPEG, PNG, or WebP image.");
  }
  if (file.size > 3 * 1024 * 1024) throw new Error("Choose an image smaller than 3 MB.");
  const url = URL.createObjectURL(file);
  const photo = new Image();
  try {
    photo.src = url;
    await photo.decode();
    if (!photo.naturalWidth || !photo.naturalHeight || photo.naturalWidth * photo.naturalHeight > 24_000_000) {
      throw new Error("Choose a photo under 24 megapixels.");
    }
    return await new Promise(resolve => {
      const dialog = document.createElement("dialog");
      dialog.className = "admin-dialog photo-crop-dialog";
      dialog.setAttribute("aria-labelledby", "photo-crop-title");
      dialog.innerHTML = `
        <h2 id="photo-crop-title">Crop fighter photo</h2>
        <p id="photo-crop-help">Drag the photo to reposition it, then zoom to frame your crop.</p>
        <div class="photo-crop-frame"><canvas width="800" height="800" tabindex="0" aria-label="Photo crop preview. Use arrow keys to reposition the photo." aria-describedby="photo-crop-help"></canvas></div>
        <div class="photo-crop-zoom-label"><label for="photo-crop-zoom">Zoom</label><span>Square · 1:1</span></div>
        <input id="photo-crop-zoom" type="range" min="1" max="4" step="0.01" value="1">
        <p class="admin-error" role="status" id="photo-crop-error"></p>
        <div class="admin-dialog-actions">
          <button class="admin-button ghost" type="button" data-reset>Reset</button>
          <button class="admin-button secondary" type="button" data-cancel>Cancel</button>
          <button class="admin-button" type="button" data-save>Save photo</button>
        </div>`;
      document.body.append(dialog);
      const canvas = dialog.querySelector("canvas");
      const context = canvas.getContext("2d");
      const zoom = dialog.querySelector("input");
      const save = dialog.querySelector("[data-save]");
      let crop = squareCrop(photo.naturalWidth, photo.naturalHeight);
      let drag = null;
      let result = null;
      function draw(centerX = crop.centerX, centerY = crop.centerY) {
        crop = squareCrop(photo.naturalWidth, photo.naturalHeight, Number(zoom.value), centerX, centerY);
        context.fillStyle = "#fff";
        context.fillRect(0, 0, 800, 800);
        context.drawImage(photo, crop.x, crop.y, crop.size, crop.size, 0, 0, 800, 800);
      }
      canvas.addEventListener("pointerdown", event => {
        if (event.button !== 0 || drag || save.disabled) return;
        canvas.setPointerCapture(event.pointerId);
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      });
      canvas.addEventListener("pointermove", event => {
        if (!drag || drag.id !== event.pointerId) return;
        const scale = crop.size / canvas.getBoundingClientRect().width;
        draw(crop.centerX - (event.clientX - drag.x) * scale, crop.centerY - (event.clientY - drag.y) * scale);
        drag.x = event.clientX;
        drag.y = event.clientY;
      });
      const endDrag = event => { if (drag?.id === event.pointerId) drag = null; };
      canvas.addEventListener("pointerup", endDrag);
      canvas.addEventListener("pointercancel", endDrag);
      canvas.addEventListener("lostpointercapture", endDrag);
      canvas.addEventListener("keydown", event => {
        const direction = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[event.key];
        if (!direction || save.disabled) return;
        event.preventDefault();
        const step = crop.size * (event.shiftKey ? 0.1 : 0.02);
        draw(crop.centerX + direction[0] * step, crop.centerY + direction[1] * step);
      });
      zoom.addEventListener("input", () => draw());
      dialog.querySelector("[data-reset]").addEventListener("click", () => {
        zoom.value = "1";
        draw(photo.naturalWidth / 2, photo.naturalHeight / 2);
      });
      dialog.querySelector("[data-cancel]").addEventListener("click", () => dialog.close());
      save.addEventListener("click", () => {
        save.disabled = true;
        save.textContent = "Preparing photo…";
        drag = null;
        canvas.toBlob(blob => {
          if (!dialog.open) return;
          if (!blob) {
            dialog.querySelector("#photo-crop-error").textContent = "The crop could not be saved. Try again.";
            save.disabled = false;
            save.textContent = "Save photo";
            return;
          }
          result = blob;
          dialog.close();
        }, "image/jpeg", 0.9);
      });
      dialog.addEventListener("close", () => {
        dialog.remove();
        resolve(result);
      }, { once: true });
      draw();
      dialog.showModal();
    });
  } catch (error) {
    if (error.name === "EncodingError") throw new Error("The image could not be read. Choose another photo.");
    throw error;
  } finally {
    photo.src = "";
    URL.revokeObjectURL(url);
  }
}
