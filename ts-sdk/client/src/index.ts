Object.assign(global, { __DEV__: process.env.NODE_ENV === "development" });

export * from "./generated";
