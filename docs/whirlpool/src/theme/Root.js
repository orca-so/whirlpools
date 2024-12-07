import React, { useEffect } from "react";
import { useLocation } from "@docusaurus/router";

export default function Root({ children }) {
  const location = useLocation();

  useEffect(() => {
    // Add the Tally script globally to your site
    const script = document.createElement("script");
    script.src = "https://tally.so/widgets/embed.js";
    script.async = true;
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  return (
    <>
      {children}
      {(
        <div style={{ position: "fixed", bottom: "20px", right: "20px", zIndex: 1000 }}>
          <button
            data-tally-open="mRZqGP"
            data-tally-width="405"
            data-tally-emoji-text="👋"
            data-tally-emoji-animation="wave"
            data-tally-auto-close="0"
            style={{
              padding: "10px 20px",
              backgroundColor: "#007bff",
              color: "white",
              border: "none",
              borderRadius: "5px",
              cursor: "pointer",
              boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)"
            }}
          >
            Share Feedback
          </button>
        </div>
      )}
    </>
  );
}
