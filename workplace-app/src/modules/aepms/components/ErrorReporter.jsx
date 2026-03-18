import React, { useEffect, useRef } from 'react';
import '../styles/global.css';
export default function ErrorReporter({ error, reset }) {
  const lastOverlayMsg = useRef("");
  const pollRef = useRef();

  useEffect(() => {
    const inIframe = window.parent !== window;
    if (!inIframe) return;

    const send = (payload) => window.parent.postMessage(payload, "*");

    const onError = (e) =>
      send({
        type: "ERROR_CAPTURED",
        error: {
          message: e.message,
          stack: e.error?.stack,
          filename: e.filename,
          lineno: e.lineno,
          colno: e.colno,
          source: "window.onerror",
        },
        timestamp: Date.now(),
      });

    const onReject = (e) =>
      send({
        type: "ERROR_CAPTURED",
        error: {
          message: e.reason?.message ?? String(e.reason),
          stack: e.reason?.stack,
          source: "unhandledrejection",
        },
        timestamp: Date.now(),
      });

    const pollOverlay = () => {
      const overlay = document.querySelector("[data-nextjs-dialog-overlay]");
      const node =
        overlay?.querySelector(
          "h1, h2, .error-message, [data-nextjs-dialog-body]"
        ) ?? null;
      const txt = node?.textContent ?? node?.innerHTML ?? "";
      if (txt && txt !== lastOverlayMsg.current) {
        lastOverlayMsg.current = txt;
        send({
          type: "ERROR_CAPTURED",
          error: { message: txt, source: "nextjs-dev-overlay" },
          timestamp: Date.now(),
        });
      }
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onReject);
    pollRef.current = setInterval(pollOverlay, 1000);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onReject);
      pollRef.current && clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    if (!error) return;
    window.parent.postMessage(
      {
        type: "global-error-reset",
        error: {
          message: error.message,
          stack: error.stack,
          digest: error.digest,
          name: error.name,
        },
        timestamp: Date.now(),
        userAgent: navigator.userAgent,
      },
      "*"
    );
  }, [error]);

  if (!error) return null;

  return (
    <div className="error-page">
      <div className="error-container">
        <div className="error-content">
          <h1 className="error-title">Something went wrong!</h1>
          <p className="error-description">
            An unexpected error occurred. Please try again.
          </p>
        </div>
        {process.env.NODE_ENV === "development" && error && (
          <details className="error-details">
            <summary className="error-summary">Error details</summary>
            <pre className="error-stack">
              {error.message}
              {error.stack && (
                <div className="error-stack-trace">{error.stack}</div>
              )}
              {error.digest && (
                <div className="error-digest">Digest: {error.digest}</div>
              )}
            </pre>
          </details>
        )}
        {reset && (
          <button onClick={reset} className="error-retry-btn">
            Try again
          </button>
        )}
      </div>
    </div>
  );
}