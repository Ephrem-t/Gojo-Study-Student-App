module.exports = new Proxy(
  {},
  {
    get(_target, property) {
      if (property === "__esModule") return false;

      return function unsupportedNodeModule() {
        throw new Error(
          `Node-only module access is unavailable in this Expo app: ${String(property)}`
        );
      };
    },
  }
);