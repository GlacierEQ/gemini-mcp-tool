import { ChildProcess, spawn } from 'child_process';
import { Logger } from '../utils/logger.js';
import { Tool } from '@modelcontextprotocol/sdk';
import { randomUUID } from 'crypto';

let cdpProcess: ChildProcess | null = null;
let cdpClient: MCPClient | null = null;

class MCPClient {
  private process: ChildProcess;
  private responsePromises = new Map<string, { resolve: (result: any) => void; reject: (error: any) => void }>();

  constructor(process: ChildProcess) {
    this.process = process;
    this.process.stdout?.on('data', this.onData.bind(this));
  }

  private onData(data: Buffer) {
    const message = data.toString();
    Logger.info(`[CDP] ${message}`);
    try {
      const json = JSON.parse(message);
      if (json.id && this.responsePromises.has(json.id)) {
        const { resolve, reject } = this.responsePromises.get(json.id)!;
        if (json.error) {
          reject(json.error);
        } else {
          resolve(json.result);
        }
        this.responsePromises.delete(json.id);
      }
    } catch (error) {
      // Not a JSON-RPC response, just log it
    }
  }

  public request(method: string, params: any): Promise<any> {
    const id = randomUUID();
    const payload = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };
    return new Promise((resolve, reject) => {
      this.responsePromises.set(id, { resolve, reject });
      this.process.stdin?.write(JSON.stringify(payload) + '\n');
    });
  }
}

export function startChromeDevTools(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (cdpProcess) {
      Logger.warn('Chrome DevTools process is already running.');
      resolve();
      return;
    }

    cdpProcess = spawn('npx', ['-y', 'chrome-devtools-mcp@latest'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    cdpProcess.stderr?.on('data', (data) => {
      Logger.error(`[CDP] ${data.toString()}`);
    });

    cdpProcess.on('close', (code) => {
      Logger.info(`Chrome DevTools process exited with code ${code}`);
      cdpProcess = null;
      cdpClient = null;
    });

    cdpProcess.on('error', (err) => {
      Logger.error('Failed to start Chrome DevTools process:', err);
      cdpProcess = null;
      cdpClient = null;
      reject(err);
    });

    cdpProcess.stdout?.on('data', (data) => {
      const message = data.toString();
      if (message.includes('MCP Server running')) {
        Logger.info('Chrome DevTools MCP server started.');
        cdpClient = new MCPClient(cdpProcess!);
        resolve();
      }
    });
  });
}

export function stopChromeDevTools(): Promise<void> {
  return new Promise((resolve) => {
    if (cdpProcess) {
      cdpProcess.kill();
      cdpProcess = null;
      cdpClient = null;
      Logger.info('Chrome DevTools MCP server stopped.');
    }
    resolve();
  });
}

export async function getChromeDevTools(): Promise<Tool[]> {
  if (!cdpClient) {
    throw new Error('Chrome DevTools client is not initialized.');
  }
  const result = await cdpClient.request('tools/list', {});
  return result.tools;
}

export async function callChromeDevTool(name: string, args: any): Promise<any> {
  if (!cdpClient) {
    throw new Error('Chrome DevTools client is not initialized.');
  }
  return cdpClient.request('tools/call', { name, arguments: args });
}