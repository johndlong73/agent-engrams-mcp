import { IHttpFetch, createHttpFetch } from './abstractions.js';

export interface EmbedderConfig {
  type: 'openai' | 'bedrock' | 'ollama';
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  profile?: string;
  region?: string;
  dimensions: number;
}

export interface Embedder {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export function createEmbedder(config: EmbedderConfig, httpFetch?: IHttpFetch): Embedder {
  const fetchImpl = httpFetch || createHttpFetch();
  switch (config.type) {
    case 'openai':
      return new OpenAIEmbedder(config, fetchImpl);
    case 'bedrock':
      return new BedrockEmbedder(config, fetchImpl);
    case 'ollama':
      return new OllamaEmbedder(config, fetchImpl);
    default:
      throw new Error(`Unknown embedder type: ${config.type}`);
  }
}

class OpenAIEmbedder implements Embedder {
  private baseUrl: string;
  private model: string;
  private apiKey?: string;
  private dimensions: number;
  private httpFetch: IHttpFetch;

  constructor(config: EmbedderConfig, httpFetch: IHttpFetch = createHttpFetch()) {
    this.baseUrl = config.baseUrl || 'http://localhost:11434/v1';
    this.model = config.model || 'Qwen3-Embedding-0.6B-4bit-DWQ';
    this.apiKey = config.apiKey;
    this.dimensions = config.dimensions;
    this.httpFetch = httpFetch;
  }

  async embed(text: string): Promise<number[]> {
    const result = await this.embedBatch([text]);
    return result[0] || [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await this.httpFetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        dimensions: this.dimensions,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI embed failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    return data.data.map((item: { embedding: number[] }) => item.embedding);
  }
}

class OllamaEmbedder implements Embedder {
  private url: string;
  private model: string;
  private httpFetch: IHttpFetch;

  constructor(config: EmbedderConfig, httpFetch: IHttpFetch = createHttpFetch()) {
    this.url = config.baseUrl?.replace(/\/$/, '') || 'http://localhost:11434';
    this.model = config.model || 'nomic-embed-text';
    this.httpFetch = httpFetch;
  }

  async embed(text: string): Promise<number[]> {
    const res = await this.httpFetch(`${this.url}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: text }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama API ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as { embeddings: number[][] };
    return json.embeddings[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Ollama /api/embed supports batch via `input` array
    // but some models/versions don't. Fall back to parallel single calls.
    const results: number[][] = [];
    for (const text of texts) {
      try {
        results.push(await this.embed(text));
      } catch {
        results.push([]);
      }
    }
    return results;
  }
}

class BedrockEmbedder implements Embedder {
  private profile!: string;
  private region!: string;
  private model!: string;
  private dimensions!: number;
  private clientPromise: Promise<any>;
  private httpFetch: IHttpFetch;

  constructor(config: EmbedderConfig, httpFetch: IHttpFetch = createHttpFetch()) {
    this.profile = config.profile || 'default';
    this.region = config.region || 'us-east-1';
    this.model = config.model || 'amazon.titan-embed-text-v2:0';
    this.dimensions = config.dimensions;
    this.httpFetch = httpFetch;

    // Lazy-load the AWS SDK
    this.clientPromise = (async () => {
      const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
      const { fromIni } = await import('@aws-sdk/credential-providers');
      return new BedrockRuntimeClient({
        region: this.region,
        credentials: fromIni({ profile: this.profile }),
      });
    })();
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0] || [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const client = await this.clientPromise;
    const { InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime');

    const results: number[][] = [];
    for (const text of texts) {
      try {
        const body = JSON.stringify({
          inputText: text,
          dimensions: this.dimensions,
          normalize: true,
        });

        const command = new InvokeModelCommand({
          modelId: this.model,
          contentType: 'application/json',
          accept: 'application/json',
          body: new TextEncoder().encode(body),
        });

        const response = await client.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));

        if (!responseBody.embedding) {
          throw new Error('Unexpected Bedrock response');
        }
        results.push(responseBody.embedding);
      } catch (err: unknown) {
        console.error(
          `Bedrock embedding failed: ${err instanceof Error ? err.message : String(err)}`
        );
        results.push([]);
      }
    }
    return results;
  }
}
