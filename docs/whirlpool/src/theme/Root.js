import React, { useState } from "react";
import Script from "next/script";

export default function Root({ children }) {
  const [isHovered, setIsHovered] = useState(false);

  const buttonStyle = {
    padding: "10px 20px",
    backgroundColor: "#FFD15C",
    color: "#13174D",
    fontSize: "18px",
    fontWeight: "500",
    border: "1px solid #13174D",
    borderRadius: "8px",
    cursor: "pointer",
    boxShadow: "3px 2px 6px rgba(0, 0, 0, 0.3)",
    transition: "transform 0.2s ease, box-shadow 0.2s ease",
    ...(isHovered && {
      transform: "translate(2px, 1px)",
      boxShadow: "None",
    }),
  };

  return (
    <>
      {children}
      <Script src="https://tally.so/widgets/embed.js" />
      <div
        style={{
          position: "fixed",
          bottom: "20px",
          right: "20px",
          zIndex: 1000,
        }}
      >
        <button
          data-tally-open="mRZqGP"
          data-tally-width="405"
          data-tally-emoji-text="👋"
          data-tally-emoji-animation="wave"
          data-tally-auto-close="0"
          style={buttonStyle}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          Share Feedback
        </button>
      </div>
    </>
  );
}
