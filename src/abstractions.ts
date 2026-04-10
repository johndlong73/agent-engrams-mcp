import * as fs from 'node:fs';
import type { McpServer } from '@modelcontextprotocol/server';

/**
 * Abstraction for file system operations to enable mocking in tests
 */
export interface IFileSystem {
  readFileSync(path: string, encoding: string): string;
  writeFileSync(path: string, data: string, encoding: string): void;
  mkdirSync(dir: string, options: { recursive: boolean }): void;
  existsSync(path: string): boolean;
  statSync(path: string): { mtimeMs: number };
  readdirSync(dir: string, options: { withFileTypes: boolean }): fs.Dirent[];
}

/**
 * Abstraction for HTTP fetch to enable mocking in tests
 */
export interface IHttpFetch {
  (url: string, options: RequestInit): Promise<Response>;
}

/**
 * Factory interface for creating MCP server instances
 */
export interface IMcpServerFactory {
  create(): McpServer;
}

/**
 * Default file system implementation using node:fs
 */
export class NodeFileSystem implements IFileSystem {
  readFileSync(path: string, encoding: BufferEncoding): string {
    return fs.readFileSync(path, encoding);
  }

  writeFileSync(path: string, data: string, encoding: BufferEncoding): void {
    fs.writeFileSync(path, data, encoding);
  }

  mkdirSync(dir: string, options: { recursive: boolean | undefined }): void {
    fs.mkdirSync(dir, { recursive: options.recursive ?? false });
  }

  existsSync(path: string): boolean {
    return fs.existsSync(path);
  }

  statSync(path: string): { mtimeMs: number } {
    return { mtimeMs: fs.statSync(path).mtimeMs };
  }

  readdirSync(dir: string, options: { withFileTypes: true }): fs.Dirent[] {
    return fs.readdirSync(dir, { withFileTypes: true });
  }
}

/**
 * Default HTTP fetch implementation using global fetch
 */
export const NodeHttpFetch: IHttpFetch = async (
  url: string,
  options: RequestInit
): Promise<Response> => {
  return fetch(url, options);
};

/**
 * Factory function to create an HTTP fetch implementation
 */
export function createHttpFetch(): IHttpFetch {
  return NodeHttpFetch;
}
