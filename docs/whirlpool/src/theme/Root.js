import React from "react";
import packageJson from "../../package.json";

export default function Root({ children }) {
  return (
    <>
      {children}
      <meta itemProp="version" content={packageJson.version} />
    </>
  );
}
