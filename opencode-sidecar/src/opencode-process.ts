import { spawn, ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";

const OPENCODE_BIN = process.env.OPENCODE_BIN || "/Users/tron/.opencode/bin/opencode";
const OPENCODE_MODEL = process.env.OPENCODE_MODEL || "opencode/big-pickle";

export interface OpenCodeRequest {
  content: string;
  model?: string;
  sessionId?: string;
}

export interface OpenCodeResponse {
  type: string;
  timestamp: number;
  sessionID: string;
  part?: {
    type: string;
    text?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export class OpenCodeProcess {
  private process: ChildProcess | null = null;
  private model: string;

  constructor(model?: string) {
    this.model = model || OPENCODE_MODEL;
  }

  async *run(request: OpenCodeRequest): AsyncGenerator<OpenCodeResponse> {
    const args = ["run", "--format", "json", "--model", request.model || this.model];
    
    if (request.sessionId) {
      args.push("--session", request.sessionId);
    }

    this.process = spawn(OPENCODE_BIN, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Write the message to stdin
    const message = JSON.stringify({ content: request.content });
    this.process.stdin?.write(message);
    this.process.stdin?.end();

    // Read JSONL from stdout
    const stdout = this.process.stdout;
    if (!stdout) {
      throw new Error("Failed to get stdout from OpenCode process");
    }

    let buffer = "";
    for await (const chunk of stdout) {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim()) {
          try {
            yield JSON.parse(line);
          } catch (e) {
            // Skip invalid JSON lines
          }
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      try {
        yield JSON.parse(buffer);
      } catch (e) {
        // Skip invalid JSON
      }
    }
  }

  kill(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}

// For HTTP-based forwarding (when OpenCode is already running as a server)
export async function runOpenCodeRequest(
  request: OpenCodeRequest,
  openCodeBin?: string,
  model?: string
): Promise<AsyncGenerator<OpenCodeResponse>> {
  const process = new OpenCodeProcess(model);
  return process.run(request);
}
