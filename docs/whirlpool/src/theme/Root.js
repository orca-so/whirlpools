import React, { useEffect } from "react";
import { useLocation } from "@docusaurus/router";

export default function Root({ children }) {
  const location = useLocation();

  useEffect(() => {
    if (location.pathname === "/whirlpools/" || location.pathname === "/") {
      window.TallyConfig = {
        formId: "mRZqGP",
        popup: {
          width: 444,
          emoji: {
            text: "👋",
            animation: "wave",
          },
          autoClose: 0,
          doNotShowAfterSubmit: true,
        }
      };

      const script = document.createElement("script");
      script.src = "https://tally.so/widgets/embed.js";
      script.async = true;
      document.body.appendChild(script);

      return () => {
        document.body.removeChild(script);
      };
    }
  }, [location.pathname]);

  return <>{children}</>;
}
