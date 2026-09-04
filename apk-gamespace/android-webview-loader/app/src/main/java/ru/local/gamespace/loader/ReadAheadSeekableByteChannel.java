package ru.local.gamespace.loader;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.ClosedChannelException;
import java.nio.channels.NonWritableChannelException;
import java.nio.channels.SeekableByteChannel;

/** Read-only seekable channel that serves small decoder reads from a fixed-size cache. */
final class ReadAheadSeekableByteChannel implements SeekableByteChannel {
    private final SeekableByteChannel source;
    private final ByteBuffer cache;
    private long position;
    private long cacheStart;
    private int cacheLength;
    private boolean open = true;

    ReadAheadSeekableByteChannel(SeekableByteChannel source, int cacheBytes) {
        if (source == null) {
            throw new NullPointerException("source");
        }
        if (cacheBytes <= 0) {
            throw new IllegalArgumentException("cacheBytes must be positive");
        }
        this.source = source;
        this.cache = ByteBuffer.allocate(cacheBytes);
    }

    @Override
    public int read(ByteBuffer target) throws IOException {
        ensureOpen();
        if (!target.hasRemaining()) {
            return 0;
        }

        int total = 0;
        while (target.hasRemaining()) {
            if (!contains(position)) {
                fill(position);
                if (cacheLength == 0) {
                    return total == 0 ? -1 : total;
                }
            }

            int cacheOffset = (int) (position - cacheStart);
            int count = Math.min(target.remaining(), cacheLength - cacheOffset);
            cache.position(cacheOffset);
            cache.limit(cacheOffset + count);
            target.put(cache);
            cache.limit(cacheLength);
            position += count;
            total += count;
        }
        return total;
    }

    private boolean contains(long value) {
        return value >= cacheStart && value < cacheStart + cacheLength;
    }

    private void fill(long start) throws IOException {
        source.position(start);
        cache.clear();
        while (cache.hasRemaining()) {
            int count = source.read(cache);
            if (count <= 0) {
                break;
            }
        }
        cache.flip();
        cacheStart = start;
        cacheLength = cache.remaining();
    }

    @Override
    public int write(ByteBuffer sourceBuffer) throws IOException {
        ensureOpen();
        throw new NonWritableChannelException();
    }

    @Override
    public long position() throws IOException {
        ensureOpen();
        return position;
    }

    @Override
    public SeekableByteChannel position(long newPosition) throws IOException {
        ensureOpen();
        if (newPosition < 0L) {
            throw new IllegalArgumentException("newPosition must not be negative");
        }
        position = newPosition;
        return this;
    }

    @Override
    public long size() throws IOException {
        ensureOpen();
        return source.size();
    }

    @Override
    public SeekableByteChannel truncate(long size) throws IOException {
        ensureOpen();
        throw new NonWritableChannelException();
    }

    @Override
    public boolean isOpen() {
        return open && source.isOpen();
    }

    @Override
    public void close() throws IOException {
        if (!open) {
            return;
        }
        open = false;
        source.close();
    }

    private void ensureOpen() throws ClosedChannelException {
        if (!isOpen()) {
            throw new ClosedChannelException();
        }
    }
}
