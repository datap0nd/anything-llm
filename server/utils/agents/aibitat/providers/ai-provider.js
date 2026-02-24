/**
 * A service that provides an AI client to create a completion.
 */

/**
 * @typedef {Object} LangChainModelConfig
 * @property {(string|null)} baseURL - Override the default base URL process.env for this provider
 * @property {(string|null)} apiKey - Override the default process.env for this provider
 * @property {(number|null)} temperature - Override the default temperature
 * @property {(string|null)} model -  Overrides model used for provider.
 */

const { v4 } = require("uuid");
const { ChatOpenAI } = require("@langchain/openai");
const { safeJsonParse } = require("../../../http");
const { getLLMProviderClass } = require("../../../helpers");
const {
  SystemPromptVariables,
} = require("../../../../models/systemPromptVariables");

const DEFAULT_WORKSPACE_PROMPT =
  "You are a helpful ai assistant who can assist the user and use tools available to help answer the users prompts and questions.";

class Provider {
  _client;

  /**
   * The invocation object containing the user ID and other invocation details.
   * @type {import("@prisma/client").workspace_agent_invocations}
   */
  invocation = {};

  /**
   * The user ID for the chat completion to send to the LLM provider for user tracking.
   * In order for this to be set, the handler props must be attached to the provider after instantiation.
   * ex: this.attachHandlerProps({ ..., invocation: { ..., user_id: 123 } });
   * eg: `user_123`
   * @type {string}
   */
  executingUserId = "";

  constructor(client) {
    if (this.constructor == Provider) {
      return;
    }
    this._client = client;
  }

  providerLog(text, ...args) {
    console.log(
      `\x1b[36m[AgentLLM${this?.model ? ` - ${this.model}` : ""}]\x1b[0m ${text}`,
      ...args
    );
  }

  /**
   * Attaches handler props to the provider for reuse in the provider.
   * - Explicitly sets the invocation object.
   * - Explicitly sets the executing user ID from the invocation object.
   * @param {Object} handlerProps - The handler props to attach to the provider.
   */
  attachHandlerProps(handlerProps = {}) {
    this.invocation = handlerProps?.invocation || {};
    this.executingUserId = this.invocation?.user_id
      ? `user_${this.invocation.user_id}`
      : "";
  }

  get client() {
    return this._client;
  }

  /**
   *
   * @param {string} provider - the string key of the provider LLM being loaded.
   * @param {LangChainModelConfig} config - Config to be used to override default connection object.
   * @returns
   */
  static LangChainChatModel(provider = "litellm", config = {}) {
    switch (provider) {
      case "litellm":
        return new ChatOpenAI({
          configuration: {
            baseURL: process.env.LITE_LLM_BASE_PATH,
          },
          apiKey: process.env.LITE_LLM_API_KEY ?? null,
          ...config,
        });
      default:
        throw new Error(`Unsupported provider ${provider} for this task.`);
    }
  }

  /**
   * Get the context limit for a provider/model combination using static method in AIProvider class.
   * @param {string} provider
   * @param {string} modelName
   * @returns {number}
   */
  static contextLimit(provider = "openai", modelName) {
    const llm = getLLMProviderClass({ provider });
    if (!llm || !llm.hasOwnProperty("promptWindowLimit")) return 8_000;
    return llm.promptWindowLimit(modelName);
  }

  static defaultSystemPromptForProvider(_provider = null) {
    return DEFAULT_WORKSPACE_PROMPT;
  }

  /**
   * Get the system prompt for a provider.
   * @param {string} provider
   * @param {import("@prisma/client").workspaces | null} workspace
   * @param {import("@prisma/client").users | null} user
   * @returns {Promise<string>}
   */
  static async systemPrompt({
    provider = null,
    workspace = null,
    user = null,
  }) {
    if (!workspace?.openAiPrompt)
      return Provider.defaultSystemPromptForProvider(provider);
    return await SystemPromptVariables.expandSystemPromptVariables(
      workspace.openAiPrompt,
      user?.id || null,
      workspace.id
    );
  }

  /**
   * Whether the provider supports agent streaming.
   * Disabled by default and needs to be explicitly enabled in the provider
   * This is temporary while we migrate all providers to support agent streaming
   * @returns {boolean}
   */
  get supportsAgentStreaming() {
    return false;
  }

  /**
   * Stream a chat completion from the LLM with tool calling
   * Note: This using the OpenAI API format and may need to be adapted for other providers.
   *
   * @param {any[]} messages - The messages to send to the LLM.
   * @param {any[]} functions - The functions to use in the LLM.
   * @param {function} eventHandler - The event handler to use to report stream events.
   * @returns {Promise<{ functionCall: any, textResponse: string }>} - The result of the chat completion.
   */
  async stream(messages, functions = [], eventHandler = null) {
    this.providerLog("Provider.stream - will process this chat completion.");
    const msgUUID = v4();
    const stream = await this.client.chat.completions.create({
      model: this.model,
      stream: true,
      messages,
      ...(Array.isArray(functions) && functions?.length > 0
        ? { functions }
        : {}),
    });

    const result = {
      functionCall: null,
      textResponse: "",
    };

    for await (const chunk of stream) {
      if (!chunk?.choices?.[0]) continue; // Skip if no choices
      const choice = chunk.choices[0];

      if (choice.delta?.content) {
        result.textResponse += choice.delta.content;
        eventHandler?.("reportStreamEvent", {
          type: "textResponseChunk",
          uuid: msgUUID,
          content: choice.delta.content,
        });
      }

      if (choice.delta?.function_call) {
        // accumulate the function call
        if (result.functionCall)
          result.functionCall.arguments += choice.delta.function_call.arguments;
        else result.functionCall = choice.delta.function_call;

        eventHandler?.("reportStreamEvent", {
          uuid: `${msgUUID}:tool_call_invocation`,
          type: "toolCallInvocation",
          content: `Assembling Tool Call: ${result.functionCall.name}(${result.functionCall.arguments})`,
        });
      }
    }

    // If there are arguments, parse them as json so that the tools can use them
    if (!!result.functionCall?.arguments)
      result.functionCall.arguments = safeJsonParse(
        result.functionCall.arguments,
        {}
      );

    return {
      textResponse: result.textResponse,
      functionCall: result.functionCall,
    };
  }
}

module.exports = Provider;
