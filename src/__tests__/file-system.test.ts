import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockFileSystem } from '../test-helpers.js';

describe('MockFileSystem', () => {
  let fileSystem: MockFileSystem;

  beforeEach(() => {
    fileSystem = new MockFileSystem();
  });

  afterEach(() => {
    fileSystem.clear();
  });

  it('should write and read files', () => {
    fileSystem.writeFileSync('/test/file.txt', 'Hello, World!', 'utf-8');
    const content = fileSystem.readFileSync('/test/file.txt', 'utf-8');
    expect(content).toBe('Hello, World!');
  });

  it('should create directories recursively', () => {
    fileSystem.mkdirSync('/a/b/c', { recursive: true });
    expect(fileSystem.existsSync('/a/b/c')).toBe(true);
  });

  it('should check if file exists', () => {
    fileSystem.writeFileSync('/test/file.txt', 'content', 'utf-8');
    expect(fileSystem.existsSync('/test/file.txt')).toBe(true);
    expect(fileSystem.existsSync('/test/nonexistent.txt')).toBe(false);
  });

  it('should list directory contents', () => {
    fileSystem.mkdirSync('/test/dir', { recursive: true });
    fileSystem.writeFileSync('/test/dir/file1.txt', 'content1', 'utf-8');
    fileSystem.writeFileSync('/test/dir/file2.txt', 'content2', 'utf-8');

    const entries = fileSystem.readdirSync('/test/dir', { withFileTypes: true });
    expect(entries).toHaveLength(2);
  });

  it('should clear all files and directories', () => {
    fileSystem.writeFileSync('/test/file1.txt', 'content1', 'utf-8');
    fileSystem.writeFileSync('/test/file2.txt', 'content2', 'utf-8');
    fileSystem.mkdirSync('/test/dir', { recursive: true });

    fileSystem.clear();

    expect(fileSystem.getAllFiles().size).toBe(0);
  });
});
