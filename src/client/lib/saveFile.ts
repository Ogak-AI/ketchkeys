/** Save a file from a Reddit webview (download attribute is often ignored). */

export async function saveBlobFile(
  blob: Blob,
  filename: string,
  mime = blob.type || 'application/octet-stream'
): Promise<void> {
  const file = new File([blob], filename, { type: mime });

  const picker = window as unknown as {
    showSaveFilePicker?: (opts: {
      suggestedName?: string;
      types?: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<{
      createWritable: () => Promise<{
        write: (data: Blob) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  };
  if (typeof picker.showSaveFilePicker === 'function') {
    const ext = filename.includes('.')
      ? `.${filename.split('.').pop()}`
      : '';
    try {
      const pickerOpts: {
        suggestedName: string;
        types?: { description: string; accept: Record<string, string[]> }[];
      } = { suggestedName: filename };
      if (ext) {
        pickerOpts.types = [{ description: 'File', accept: { [mime]: [ext] } }];
      }
      const handle = await picker.showSaveFilePicker(pickerOpts);
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }
    }
  }

  const nav = navigator as Navigator & {
    canShare?: (data: { files?: File[] }) => boolean;
    share?: (data: { files?: File[]; title?: string }) => Promise<void>;
  };
  if (typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
    try {
      await nav.share?.({ files: [file], title: filename });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 4_000);
  }
}
