// Measure the Blob primitives used by zip.js, including its native streaming path.
// Counting only BlobReader.readUint8Array would miss streamed entry data.
export function measuredBlob(blob, statistics) {
  return {
    size: blob.size,
    type: blob.type,
    slice: (...args) => measuredBlob(blob.slice(...args), statistics),
    arrayBuffer: () => statistics.async("read", () => blob.arrayBuffer(), (value) => value.byteLength),
    stream() {
      const reader = blob.stream().getReader();
      return new ReadableStream({
        async pull(controller) {
          try {
            const chunk = await statistics.async("read", () => reader.read(), (value) => value.value?.byteLength || 0);
            if (chunk.done) { reader.releaseLock(); controller.close(); }
            else controller.enqueue(chunk.value);
          } catch (error) { reader.releaseLock(); controller.error(error); }
        },
        async cancel(reason) {
          try { await reader.cancel(reason); }
          finally { reader.releaseLock(); }
        },
      });
    },
  };
}
