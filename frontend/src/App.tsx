
import { FormEvent, useEffect, useState } from "react";
import {
  BookOpen,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Info,
  Landmark,
  LoaderCircle,
  MessageSquare,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";

type Source = {
  sourceId: string;
  document: string;
  page: number;
  section?: string;
  excerpt?: string;
  score: number;
  text?: string;
  content?: string;
  pageContent?: string;
};

type Message = {
  role: "assistant" | "user";
  content: string;
  sources?: Source[];
  abstained?: boolean;
};

type Chat = {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
};

const STORAGE_KEY = "cedarassist-chat-history";

const WELCOME_MESSAGE: Message = {
  role: "assistant",
  content:
    "Hi! I’m CedarAssist. Ask me about municipal service requests, by-laws, permits, or licensing. I’ll answer from the provided Cedarhaven PDFs and show the source pages.",
};

const examples = [
  "How do I report a pothole?",
  "What are the construction noise hours?",
  "What do I need for a shed permit?",
  "How can I track a service request?",
];

function makeChat(): Chat {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: "New conversation",
    messages: [WELCOME_MESSAGE],
    updatedAt: Date.now(),
  };
}

function getExcerpt(source: Source): string {
  const candidates = [
    source.excerpt,
    source.text,
    source.content,
    source.pageContent,
  ];

  const excerpt = candidates.find(
    (value) => typeof value === "string" && value.trim().length > 0
  );

  return excerpt?.trim() ?? "";
}

function getPreviousUserQuestion(
  messages: Message[],
  assistantIndex: number
): string {
  for (let i = assistantIndex - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      return messages[i].content;
    }
  }

  return "";
}

function getEvidenceLabel(score: number) {
  if (score >= 0.45) {
    return {
      label: "Strong retrieval match",
      color: "#166534",
      background: "#dcfce7",
      description:
        "The retrieved passage has a strong similarity signal for the question. Verify the cited text for the actual answer.",
    };
  }

  if (score >= 0.34) {
    return {
      label: "Relevant retrieval match",
      color: "#92400e",
      background: "#fef3c7",
      description:
        "The retrieved passage may be relevant. Check that it directly supports the answer.",
    };
  }

  return {
    label: "Limited retrieval match",
    color: "#991b1b",
    background: "#fee2e2",
    description:
      "The retrieval signal is relatively weak. Read the source carefully before relying on the answer.",
  };
}

function getActionItems(question: string, answer: string): string[] {
  const q = question.toLowerCase();
  const a = answer.toLowerCase();

  const isServiceQuestion =
    /service request|report a pothole|report an issue|report a problem|submit a request|311|municipal request/.test(
      q
    );

  if (!isServiceQuestion) return [];

  const items: string[] = [];

  if (/issue category/.test(a)) {
    items.push("Identify the category of the issue.");
  }

  if (/location|nearest intersection/.test(a)) {
    items.push("Note the location or nearest intersection.");
  }

  if (/clear description|description of the issue/.test(a)) {
    items.push("Write a clear description of the problem.");
  }

  if (/date the issue was first observed|date.*observed/.test(a)) {
    items.push("Note when the issue was first observed.");
  }

  if (/service portal/.test(a)) {
    items.push("Consider the Cedarhaven Service Portal as a reporting channel.");
  } else if (/311 contact centre/.test(a)) {
    items.push("Review the 311 contact centre details given in the answer.");
  }

  return items;
}

export default function App() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState("");
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string[]>([]);
  const [plannerCategory, setPlannerCategory] = useState("service");
  const [plannerDetails, setPlannerDetails] = useState("");
  const [checkedActions, setCheckedActions] = useState<
    Record<string, boolean>
  >({});
  const [showHistory, setShowHistory] = useState(true);

  const activeChat = chats.find((chat) => chat.id === activeChatId);
  const messages = activeChat?.messages ?? [];

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);

      if (saved) {
        const parsed: unknown = JSON.parse(saved);

        if (Array.isArray(parsed) && parsed.length > 0) {
          const validChats = parsed.filter(
            (chat): chat is Chat =>
              chat !== null &&
              typeof chat === "object" &&
              typeof chat.id === "string" &&
              typeof chat.title === "string" &&
              Array.isArray(chat.messages) &&
              typeof chat.updatedAt === "number"
          );

          if (validChats.length > 0) {
            setChats(validChats);

            const savedActiveId = localStorage.getItem(
              "cedarassist-active-chat"
            );

            setActiveChatId(
              validChats.some((chat) => chat.id === savedActiveId)
                ? savedActiveId!
                : validChats[0].id
            );

            setHistoryLoaded(true);
            return;
          }
        }
      }
    } catch (err) {
      console.error("Could not load chat history:", err);
    }

    const initialChat = makeChat();
    setChats([initialChat]);
    setActiveChatId(initialChat.id);
    setHistoryLoaded(true);
  }, []);

  useEffect(() => {
    if (!historyLoaded) return;

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
      localStorage.setItem("cedarassist-active-chat", activeChatId);
    } catch (err) {
      console.error("Could not save chat history:", err);
      setError("Chat history could not be saved. Browser storage may be full.");
    }
  }, [chats, activeChatId, historyLoaded]);

  function updateActiveChat(
    updater: (current: Chat) => Chat
  ) {
    setChats((oldChats) =>
      oldChats.map((chat) =>
        chat.id === activeChatId
          ? updater(chat)
          : chat
      )
    );
  }

  function updateMessages(updater: (old: Message[]) => Message[]) {
    updateActiveChat((chat) => {
      const updatedMessages = updater(chat.messages);
      const firstQuestion = updatedMessages.find(
        (message) => message.role === "user"
      );

      return {
        ...chat,
        messages: updatedMessages,
        title: firstQuestion
          ? firstQuestion.content.trim().slice(0, 48) +
            (firstQuestion.content.trim().length > 48 ? "…" : "")
          : chat.title,
        updatedAt: Date.now(),
      };
    });
  }

  function startNewChat() {
    if (loading) return;

    const newChat = makeChat();

    setChats((oldChats) => [newChat, ...oldChats]);
    setActiveChatId(newChat.id);
    setQuestion("");
    setError("");
    setExpanded([]);
    setCheckedActions({});
    setPlannerDetails("");
    setPlannerCategory("service");
  }

  function openChat(chatId: string) {
    if (loading) return;

    setActiveChatId(chatId);
    setQuestion("");
    setError("");
    setExpanded([]);
    setCheckedActions({});
    setPlannerDetails("");
  }

  function deleteChat(chatId: string) {
    if (loading) return;

    const remaining = chats.filter((chat) => chat.id !== chatId);

    if (remaining.length === 0) {
      const newChat = makeChat();
      setChats([newChat]);
      setActiveChatId(newChat.id);
      setError("");
      return;
    }

    setChats(remaining);

    if (activeChatId === chatId) {
      setActiveChatId(remaining[0].id);
      setQuestion("");
      setError("");
      setExpanded([]);
      setCheckedActions({});
    }
  }

  async function sendQuestion(text = question) {
    const clean = text.trim();

    if (clean.length < 3 || loading || !activeChatId) return;

    const chatId = activeChatId;

    setChats((oldChats) =>
      oldChats.map((chat) => {
        if (chat.id !== chatId) return chat;

        const nextMessages = [
          ...chat.messages,
          { role: "user" as const, content: clean },
        ];

        return {
          ...chat,
          messages: nextMessages,
          title:
            chat.messages.some((message) => message.role === "user")
              ? chat.title
              : clean.slice(0, 48) + (clean.length > 48 ? "…" : ""),
          updatedAt: Date.now(),
        };
      })
    );

    setQuestion("");
    setError("");
    setLoading(true);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL || "http://localhost:4000"}/api/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: clean }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "The assistant could not answer right now."
        );
      }

      const assistantMessage: Message = {
        role: "assistant",
        content: data.answer,
        sources: Array.isArray(data.sources) ? data.sources : [],
        abstained: Boolean(data.abstained),
      };

      setChats((oldChats) =>
        oldChats.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                messages: [...chat.messages, assistantMessage],
                updatedAt: Date.now(),
              }
            : chat
        )
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Network error. Check whether the backend is running."
      );
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void sendQuestion();
  }

  function buildActionPlan(e: FormEvent) {
    e.preventDefault();

    const details = plannerDetails.trim();

    if (details.length < 5 || loading) return;

    let questionForRag = "";

    if (plannerCategory === "service") {
      questionForRag =
        `How do I submit a service request in Cedarhaven for this issue: ${details}?`;
    } else if (plannerCategory === "bylaw") {
      questionForRag =
        `What should I do to report or handle a by-law complaint in Cedarhaven about: ${details}?`;
    } else {
      questionForRag =
        `What steps and requirements are documented for a Cedarhaven permit or licence related to: ${details}?`;
    }

    const groundedPrompt =
      `${questionForRag}\n\n` +
      "Create a practical, numbered action plan using only the provided Cedarhaven documents. " +
      "Include relevant preparation details where supported by the documents. " +
      "Cite every factual claim using the source citation format. " +
      "Clearly state when a requirement or next step cannot be verified from the documents. " +
      "Do not invent fees, deadlines, contact details, or requirements.";

    void sendQuestion(groundedPrompt);
    setPlannerDetails("");
  }

  function toggleExcerpt(key: string) {
    setExpanded((old) =>
      old.includes(key)
        ? old.filter((item) => item !== key)
        : [...old, key]
    );
  }

  function toggleAction(key: string) {
    setCheckedActions((old) => ({
      ...old,
      [key]: !old[key],
    }));
  }

  if (!historyLoaded || !activeChat) {
    return (
      <div className="app-shell" style={{ padding: 30 }}>
        <LoaderCircle className="spin" size={24} />
        Loading CedarAssist…
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">
            <Landmark size={22} />
          </div>
          <div>
            <strong>CedarAssist</strong>
            <span>Municipal Knowledge Assistant</span>
          </div>
        </div>

        <div className="trust">
          <ShieldCheck size={16} />
          Evidence-first answers
        </div>
      </header>

      <main className="layout">
        <aside className="sidebar">
          <div className="town-mark">
            <Landmark size={26} />
            <div>
              <strong>Town of Cedarhaven</strong>
              <span>Municipal Service Library</span>
            </div>
          </div>

          <button
            type="button"
            onClick={startNewChat}
            disabled={loading}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: "11px 12px",
              margin: "18px 0",
              border: "none",
              borderRadius: 10,
              background: "#173f35",
              color: "#fff",
              cursor: loading ? "not-allowed" : "pointer",
              fontWeight: 700,
            }}
          >
            <Plus size={17} />
            New Chat
          </button>

          <button
            type="button"
            onClick={() => setShowHistory((old) => !old)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 8,
              border: "none",
              background: "transparent",
              padding: "8px 0",
              cursor: "pointer",
              fontWeight: 700,
              color: "#173f35",
              textAlign: "left",
            }}
          >
            <MessageSquare size={17} />
            CHAT HISTORY
            <span style={{ marginLeft: "auto" }}>
              {showHistory ? "−" : "+"}
            </span>
          </button>

          {showHistory && (
            <div
              style={{
                display: "grid",
                gap: 6,
                marginTop: 8,
                marginBottom: 20,
              }}
            >
              {chats
                .slice()
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .map((chat) => (
                  <div
                    key={chat.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "8px 6px",
                      borderRadius: 9,
                      background:
                        chat.id === activeChatId ? "#e3eee7" : "transparent",
                      border:
                        chat.id === activeChatId
                          ? "1px solid #c8dbcf"
                          : "1px solid transparent",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => openChat(chat.id)}
                      disabled={loading}
                      title={chat.title}
                      style={{
                        display: "flex",
                        flex: 1,
                        minWidth: 0,
                        flexDirection: "column",
                        gap: 4,
                        textAlign: "left",
                        border: "none",
                        background: "transparent",
                        cursor: loading ? "not-allowed" : "pointer",
                        color: "#263a30",
                      }}
                    >
                      <span
                        style={{
                          overflow: "hidden",
                          whiteSpace: "nowrap",
                          textOverflow: "ellipsis",
                          width: "100%",
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        {chat.title}
                      </span>
                      <span style={{ fontSize: 10, color: "#758078" }}>
                        {new Date(chat.updatedAt).toLocaleString()}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => deleteChat(chat.id)}
                      disabled={loading}
                      aria-label={`Delete ${chat.title}`}
                      title="Delete conversation"
                      style={{
                        flexShrink: 0,
                        padding: 5,
                        border: "none",
                        borderRadius: 6,
                        background: "transparent",
                        color: "#8a514b",
                        cursor: loading ? "not-allowed" : "pointer",
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}

              {chats.length === 0 && (
                <p style={{ fontSize: 12, color: "#758078" }}>
                  No saved conversations yet.
                </p>
              )}
            </div>
          )}

          <div className="side-heading">KNOWLEDGE SOURCES</div>

          <div className="doc-item">
            <FileText size={18} />
            <div>
              <strong>Service Request Management</strong>
              <span>CH-SRM-01 · 8 pages</span>
            </div>
          </div>

          <div className="doc-item">
            <FileText size={18} />
            <div>
              <strong>By-law Enforcement</strong>
              <span>CH-BYL-02 · 8 pages</span>
            </div>
          </div>

          <div className="doc-item">
            <FileText size={18} />
            <div>
              <strong>Permits & Licensing</strong>
              <span>CH-PER-03 · 8 pages</span>
            </div>
          </div>

          <div className="notice">
            <ShieldCheck size={17} />
            <p>
              <strong>Evidence first</strong>
              <br />
              Answers are based on the supplied documents. If the information
              is missing, the assistant should say so.
            </p>
          </div>

          <p className="disclaimer">
            Cedarhaven is fictional. These PDFs are training materials, not
            real-world municipal or legal advice.
          </p>
        </aside>

        <section className="chat-panel">
          <div className="chat-heading">
            <div>
              <h1>How can we help?</h1>
              <p>
                Ask a question about municipal services, by-laws, or permits.
              </p>
            </div>
            <div className="online">
              <span />
              Ready
            </div>
          </div>

          <div className="messages" aria-live="polite">
            <section className="action-planner">
              <div className="planner-heading">
                <div className="planner-icon">✦</div>
                <div>
                  <h2>Action Planner</h2>
                  <p>
                    Turn your municipal question into evidence-based next steps.
                  </p>
                </div>
              </div>

              <form className="planner-form" onSubmit={buildActionPlan}>
                <label htmlFor="planner-category">
                  What do you need help with?
                </label>

                <select
                  id="planner-category"
                  value={plannerCategory}
                  onChange={(e) => setPlannerCategory(e.target.value)}
                  disabled={loading}
                >
                  <option value="service">Report a municipal issue</option>
                  <option value="bylaw">Report a by-law concern</option>
                  <option value="permit">Permit or licensing guidance</option>
                </select>

                <label htmlFor="planner-details">
                  Describe your situation
                </label>

                <textarea
                  id="planner-details"
                  value={plannerDetails}
                  onChange={(e) => setPlannerDetails(e.target.value)}
                  placeholder="Example: There is a pothole near my house at the main intersection..."
                  rows={3}
                  maxLength={500}
                  disabled={loading}
                  required
                  minLength={5}
                />

                <button
                  type="submit"
                  className="planner-submit"
                  disabled={loading || plannerDetails.trim().length < 5}
                >
                  Create my action plan
                  <span aria-hidden="true"> →</span>
                </button>
              </form>

              <p className="planner-footnote">
                Plans are based on the available Cedarhaven documents.
                Unverified details will not be presented as confirmed facts.
              </p>
            </section>

            {messages.map((message, i) => (
              <div
                className={`message-row ${message.role}`}
                key={`${activeChatId}-${i}-${message.role}`}
              >
                <div className="avatar">
                  {message.role === "assistant" ? (
                    <Bot size={18} />
                  ) : (
                    <UserRound size={18} />
                  )}
                </div>

                <div className="message-body">
                  <div className="message-label">
                    {message.role === "assistant" ? "CedarAssist" : "You"}
                  </div>

                  <div className="bubble">{message.content}</div>

                  {message.role === "assistant" &&
                    message.sources &&
                    message.sources.length > 0 &&
                    !message.abstained && (
                      <div
                        style={{
                          marginTop: 12,
                          padding: 14,
                          border: "1px solid #dbe5e1",
                          borderRadius: 14,
                          background: "#f8fbf9",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            fontWeight: 700,
                            marginBottom: 10,
                            color: "#173f35",
                          }}
                        >
                          <ShieldCheck size={19} />
                          Evidence snapshot
                        </div>

                        {(() => {
                          const bestScore = Math.max(
                            ...message.sources!.map(
                              (source) => Number(source.score) || 0
                            )
                          );

                          const evidence = getEvidenceLabel(bestScore);

                          return (
                            <div>
                              <span
                                style={{
                                  display: "inline-block",
                                  background: evidence.background,
                                  color: evidence.color,
                                  borderRadius: 20,
                                  padding: "5px 10px",
                                  fontSize: 12,
                                  fontWeight: 700,
                                }}
                              >
                                {evidence.label}
                              </span>

                              <p
                                style={{
                                  fontSize: 12,
                                  lineHeight: 1.6,
                                  color: "#59665f",
                                  margin: "9px 0 0",
                                }}
                              >
                                {evidence.description}
                              </p>
                            </div>
                          );
                        })()}

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                            marginTop: 12,
                            fontSize: 12,
                            color: "#52645c",
                          }}
                        >
                          <Info size={15} />
                          Similarity is a retrieval signal, not a guarantee
                          that an answer is correct.
                        </div>
                      </div>
                    )}

                  {message.role === "assistant" &&
                    message.sources &&
                    message.sources.length > 0 &&
                    !message.abstained &&
                    (() => {
                      const previousQuestion = getPreviousUserQuestion(
                        messages,
                        i
                      );

                      const actionItems = getActionItems(
                        previousQuestion,
                        message.content
                      );

                      if (!actionItems.length) return null;

                      const completedCount = actionItems.filter(
                        (_, index) =>
                          checkedActions[`${activeChatId}-${i}-action-${index}`]
                      ).length;

                      return (
                        <div
                          style={{
                            marginTop: 12,
                            padding: 15,
                            border: "1px solid #d6e6dc",
                            borderRadius: 14,
                            background: "#ffffff",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 9,
                              marginBottom: 6,
                              color: "#173f35",
                            }}
                          >
                            <ClipboardCheck size={20} />
                            <strong>Your reporting checklist</strong>
                          </div>

                          <p
                            style={{
                              fontSize: 12,
                              color: "#65736b",
                              margin: "0 0 12px",
                            }}
                          >
                            Prepare the details supported by the answer.
                          </p>

                          <div
                            style={{
                              height: 5,
                              background: "#e8eee9",
                              borderRadius: 10,
                              overflow: "hidden",
                              marginBottom: 12,
                            }}
                          >
                            <div
                              style={{
                                height: "100%",
                                width: `${
                                  (completedCount / actionItems.length) * 100
                                }%`,
                                background: "#26815e",
                                transition: "width 150ms ease",
                              }}
                            />
                          </div>

                          {actionItems.map((item, index) => {
                            const actionKey =
                              `${activeChatId}-${i}-action-${index}`;

                            const checked = Boolean(checkedActions[actionKey]);

                            return (
                              <label
                                key={actionKey}
                                style={{
                                  display: "flex",
                                  alignItems: "flex-start",
                                  gap: 10,
                                  padding: "9px 0",
                                  cursor: "pointer",
                                  fontSize: 13,
                                  lineHeight: 1.5,
                                  color: checked ? "#7b8880" : "#293a31",
                                  textDecoration: checked
                                    ? "line-through"
                                    : "none",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleAction(actionKey)}
                                  style={{
                                    marginTop: 3,
                                    accentColor: "#26815e",
                                  }}
                                />
                                <span>{item}</span>
                                {checked && (
                                  <CheckCircle2
                                    size={15}
                                    color="#26815e"
                                    style={{
                                      flexShrink: 0,
                                      marginLeft: "auto",
                                    }}
                                  />
                                )}
                              </label>
                            );
                          })}

                          <p
                            style={{
                              margin: "10px 0 0",
                              fontSize: 11,
                              color: "#77837b",
                            }}
                          >
                            {completedCount} of {actionItems.length} completed
                          </p>
                        </div>
                      );
                    })()}

                  {message.sources && message.sources.length > 0 && (
                    <div className="sources">
                      <div className="sources-title">
                        <BookOpen size={15} />
                        Sources used
                      </div>

                      {message.sources.map((source, sourceIndex) => {
                        const key =
                          `${activeChatId}-${i}-${source.sourceId || sourceIndex}`;

                        const isExpanded = expanded.includes(key);
                        const excerpt = getExcerpt(source);

                        return (
                          <div className="source-card" key={key}>
                            <div className="source-top">
                              <div className="source-icon">
                                <FileText size={16} />
                              </div>

                              <div className="source-name">
                                <strong>
                                  {(source.document || "Source document")
                                    .replace(/^\d+_/, "")
                                    .replaceAll("_", " ")
                                    .replace(/\.pdf$/i, "")}
                                </strong>

                                <span>
                                  PDF page {source.page}
                                  {source.section ? ` · ${source.section}` : ""}
                                </span>
                              </div>

                              <button
                                type="button"
                                className="text-button"
                                onClick={() => toggleExcerpt(key)}
                                aria-expanded={isExpanded}
                              >
                                {isExpanded ? "Hide excerpt" : "View excerpt"}
                              </button>
                            </div>

                            {isExpanded && (
                              <div className="excerpt">
                                {excerpt ? (
                                  <p>{excerpt}</p>
                                ) : (
                                  <p>
                                    Excerpt text was not included in the
                                    backend response. The frontend cannot
                                    display the PDF passage until the backend
                                    sends it.
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {message.abstained && (
                    <div className="abstain-note">
                      No sufficiently supported answer found in the supplied
                      documents.
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="message-row assistant">
                <div className="avatar">
                  <Bot size={18} />
                </div>
                <div className="message-body">
                  <div className="message-label">CedarAssist</div>
                  <div className="bubble loading">
                    <LoaderCircle className="spin" size={17} />
                    Searching the municipal documents…
                  </div>
                </div>
              </div>
            )}
          </div>

          {messages.length === 1 && (
            <div className="suggestions">
              <div className="suggestion-label">TRY ASKING</div>
              <div className="suggestion-grid">
                {examples.map((example) => (
                  <button
                    key={example}
                    type="button"
                    className="suggestion"
                    onClick={() => void sendQuestion(example)}
                  >
                    {example}
                    <span>↗</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}

          <form className="composer" onSubmit={onSubmit}>
            <input
              aria-label="Your question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about a service, by-law, or permit…"
              maxLength={1000}
              disabled={loading}
            />

            <button
              type="submit"
              disabled={loading || question.trim().length < 3}
              aria-label="Send question"
            >
              <Send size={18} />
            </button>
          </form>

          <div className="composer-foot">
            AI can make mistakes. Verify important information against the
            cited document.
          </div>
        </section>
      </main>
    </div>
  );
}
