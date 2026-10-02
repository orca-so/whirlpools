import React from "react";
import Head from "@docusaurus/Head";
import packageJson from "../../package.json";

export default function Root({ children }) {
  return (
    <>
      {children}
      <Head>
        <meta itemProp="version" content={packageJson.version} />
      </Head>
    </>
  );
}
