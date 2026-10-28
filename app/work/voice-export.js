/** Save a prepared file through iOS's share sheet or the browser's download manager. */
export async function saveVoiceFile(blob, name) {
  const native = window.Capacitor?.isNativePlatform?.();
  if (native) {
    const plugin = window.Capacitor?.Plugins?.Native;
    if (!plugin?.exportFile) throw new Error('This app build cannot export files yet. The recording is still kept.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return plugin.exportFile({ name, base64: btoa(binary) });
  }
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
