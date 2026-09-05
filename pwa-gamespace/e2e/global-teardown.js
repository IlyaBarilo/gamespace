export default async function stopReleaseServer() {
  // Close our server explicitly before Playwright's process-tree cleanup.
  // This also removes the isolated release copies on Windows.
  try {
    await fetch("http://127.0.0.2:4177/__e2e_shutdown__", { method: "POST", signal: AbortSignal.timeout(10_000) });
  } catch { /* Startup failures may leave no server to stop. */ }
}
