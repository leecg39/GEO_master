import dns from "node:dns";

// Some networks cache a negative answer while a Quick Tunnel is being created.
// Limit the fallback to this tool's temporary hosts; keep normal TLS validation.
export function withQuickTunnelDns(lookup, resolver) {
  return (hostname, options, callback) => {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    const settings = typeof options === "number" ? { family: options } : (options ?? {});
    return lookup(hostname, options, (error, address, family) => {
      if (
        !error ||
        !["ENOTFOUND", "EAI_AGAIN"].includes(error.code) ||
        typeof hostname !== "string" ||
        !/^[a-z0-9-]+\.trycloudflare\.com$/i.test(hostname)
      ) {
        callback(error, address, family);
        return;
      }
      const fallbackFamily = settings.family === 6 ? 6 : 4;
      const resolve = fallbackFamily === 6 ? "resolve6" : "resolve4";
      resolver[resolve](hostname, (fallbackError, addresses) => {
        if (fallbackError || !addresses?.length) {
          callback(error);
          return;
        }
        if (settings.all) {
          callback(null, addresses.map((entry) => ({ address: entry, family: fallbackFamily })));
        } else {
          callback(null, addresses[0], fallbackFamily);
        }
      });
    });
  };
}

const resolver = new dns.Resolver({ timeout: 1500, tries: 1 });
resolver.setServers(["1.1.1.1", "1.0.0.1"]);
dns.lookup = withQuickTunnelDns(dns.lookup, resolver);
