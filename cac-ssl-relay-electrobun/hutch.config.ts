export default {
  electrobun: { version: "2.0.5" },
  scripts: {
    setup: ["hutch", "electrobun", "prepare"],
    start: ["hutch", "electrobun", "dev"],
    dev: ["hutch", "electrobun", "dev", "--watch"],
    build: ["hutch", "electrobun", "build", "--env=stable"],
  },
};
