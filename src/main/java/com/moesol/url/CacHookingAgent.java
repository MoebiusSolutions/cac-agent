package com.moesol.url;

import java.io.File;
import java.lang.instrument.Instrumentation;

import com.moesol.cac.agent.selector.SwingSelectorKeyManager;

public class CacHookingAgent {
	public static final String CAC_AGENT_DIR = ".moesol/cac-agent";
	public static boolean DEBUG = false;
	public static String CONTEXT = "TLS";

	public static void premain(String args, Instrumentation inst) throws Exception {
		System.out.println("CAC Agent hooking SSL with args: " + args);
		Config config = Config.loadFromUserHome();
		if (args != null) {
			processArgs(args, config);
		}
		maybeSetTrustSystemProperties(config);
		maybeSetTrustFile();
		SwingSelectorKeyManager.configureSwingKeyManagerAsDefault();
	}
	
	public static void maybeSetTrustFile() {
		File trustStoreFile = new File(System.getProperty("user.home"), CAC_AGENT_DIR + "/truststore.jks");
		if (trustStoreFile.canRead()) {
			System.out.println("Using trustore " + trustStoreFile.getPath());
			System.setProperty("javax.net.ssl.trustStoreType", "JKS");
			System.setProperty("javax.net.ssl.trustStore", trustStoreFile.getPath());
		}
	}

	private static void maybeSetTrustSystemProperties(Config config) {
		if (config.isUseWindowsTrust()) {
			System.setProperty("javax.net.ssl.trustStoreType", "Windows-ROOT");
			System.setProperty("javax.net.ssl.trustStore", "NONE");
		}
	}

	static void processArgs(String args, Config config) {
		String[] split = args.split(",\\s*");
		for (String s : split) {
			if (s.equals("debug")) {
				DEBUG = true;
			}
			if (s.startsWith("context=")) {
				CONTEXT = s.replace("context=", "");
			}
			if (s.equals("windowsTrust")) {
				config.setUseWindowsTrust(true);
			}
			if (s.equals("help")) {
				showHelp();
			}
		}
	}

	private static void showHelp() {
		System.out.println("Options: debug | context={c} | | windowsTrust | help");
		System.out.println("{c} -- SSL, SSLv2, SSLv3, TLS, TLSv1, TLSv1.1, TLSv1.2"); 
	}
}
