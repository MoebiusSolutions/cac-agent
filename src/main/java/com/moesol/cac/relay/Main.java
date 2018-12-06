package com.moesol.cac.relay;

import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.security.KeyManagementException;
import java.security.NoSuchAlgorithmException;
import java.util.List;
import java.util.Map;
import java.util.Map.Entry;
import java.util.logging.Level;
import java.util.logging.Logger;
import java.util.stream.Collectors;

import com.moesol.cac.agent.CacHookingAgent;
import com.moesol.cac.agent.Config;
import com.moesol.cac.agent.selector.AbstractSelectorKeyManager;

public class Main {
	private static Logger LOGGER = Logger.getLogger(Main.class.getName());
	private final Map<String, String> bindings;
	private final Map<String, String> secureBindings;

	public Main(Config config) {
		bindings = config.getRelays();
		secureBindings = config.getSecureRelays();
	}

	public static void main(String[] args) throws IOException, KeyManagementException, NoSuchAlgorithmException {
		Config config = Config.loadFromUserHome();
		setUpSslForCac(config);

		new Main(config).run();
	}

	private static void setUpSslForCac(Config config) throws NoSuchAlgorithmException, KeyManagementException {
		CacHookingAgent.maybeSetTrustFile(); // Must come before below...
		AbstractSelectorKeyManager.configureSwingKeyManagerAsDefault(config);
	}

	// TODO: Refactor bindings and secureBindings to reduce code duplication.
	public void run() {
		List<Thread> threads = bindings.entrySet().stream().map(this::makeThreadForEntry).collect(Collectors.toList());
		List<Thread> threads2 = secureBindings.entrySet().stream().map(this::makeSslThreadForEntry).collect(Collectors.toList());
		if (threads.size() == 0) {
			LOGGER.log(Level.WARNING, "No bindings configured in agent.properties file");
		} else {
			System.out.println("all started");
		}
		threads.forEach(this::join);
		threads2.forEach(this::join);
	}

	public Thread makeThreadForEntry(Entry<String, String> entry) {
		System.out.println("entry: " + entry);
		URI src = parse(entry.getKey());
		URI dst = parse(entry.getValue());

		ServerRelay relay = new ServerRelay(src.getHost(), src.getPort(), dst.getHost(), dst.getPort());
		return thread(relay::run);
	}
	public Thread makeSslThreadForEntry(Entry<String, String> entry) {
		System.out.println("ssl entry: " + entry);
		URI src = parse(entry.getKey());
		URI dst = parse(entry.getValue());

		SslServerRelay relay = new SslServerRelay(src.getHost(), src.getPort(), dst.getHost(), dst.getPort());
		return thread(relay::run);
	}

	private URI parse(String key) {
		try {
			URI uri = new URI("relay://" + key);
			if (uri.getHost() == null || uri.getPort() == -1) {
				throw new URISyntaxException(uri.toString(), "URI must have host and port parts");
			}
			return uri;
		} catch (URISyntaxException e) {
			throw new RuntimeException(e);
		}
	}

	public Thread thread(Runnable r) {
		Thread thread = new Thread(r, "relay-listener");
		thread.start();
		return thread;
	}

	public void join(Thread t) {
		try {
			t.join();
		} catch (InterruptedException e) {
			throw new RuntimeException(e);
		}
	}

}
