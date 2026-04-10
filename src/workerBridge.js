export class WorkerBridge {
  constructor() {
    this.worker = new Worker(new URL("./csvWorker.js", import.meta.url), { type: "module" });
    this.pending = new Map(); // messageId → { resolve, reject }
    this.progressCallback = null;
    this.worker.onmessage = (e) => this._handleMessage(e.data);
    this.worker.onerror = (err) => {
      console.error("Worker error:", err);
    };
  }

  _handleMessage(msg) {
    if (msg.type === "progress") {
      if (this.progressCallback) {
        this.progressCallback(msg);
      }
      return;
    }

    if (msg.type === "result" && msg.id) {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        if (msg.error) {
          p.reject(new Error(msg.error));
        } else {
          p.resolve(msg.data);
        }
      }
    }
  }

  _send(command, data) {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, command, ...data });
    });
  }

  onProgress(callback) {
    this.progressCallback = callback;
  }

  parseFile(fileId, file, raName, raNumber, raOrg) {
    return this._send("parseFile", { fileId, file, raName, raNumber, raOrg });
  }

  removeFile(fileId) {
    return this._send("removeFile", { fileId });
  }

  clearAll() {
    return this._send("clearAll", {});
  }

  checkDuplicates(typeKey, fileIds) {
    return this._send("checkDuplicates", { typeKey, fileIds });
  }

  buildCSV(typeKey, fileIds, dedup) {
    return this._send("buildCSV", { typeKey, fileIds, dedup });
  }

  terminate() {
    this.worker.terminate();
    for (const p of this.pending.values()) {
      p.reject(new Error("Worker terminated"));
    }
    this.pending.clear();
  }
}
