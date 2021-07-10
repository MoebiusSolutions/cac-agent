package com.moesol.cac.agent;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.Properties;

import org.jasypt.util.text.BasicTextEncryptor;

public class Config {
	private static final String CAC_AGENT_DIR = ".moesol/cac-agent";
	private static final String COM_MOESOL_AGENT_PROFILE = "com.moesol.agent.profile";
	private static final String COM_MOESOL_AGENT_CONFIG  = "com.moesol.agent.config";
	private static final String AGENT_PROPERTIES = "agent.properties";

	private boolean useWindowsTrust = true;
	private boolean checkCertIssuer = true;
	private String defaultCertificateName = null;
	private boolean tty = false;
	private String user = null;
	private String encryptedPassword = null;
	private String master = null;
	private final Map<String, String> relays = new HashMap<>();
	private final Map<String, String> secureRelays = new HashMap<>();

	public boolean isTty() {
		return tty;
	}

	public void setTty(boolean b) {
		tty = b;
	}

	public boolean isUseWindowsTrust() {
		return useWindowsTrust;
	}

	public void setUseWindowsTrust(boolean useWindowsTrust) {
		this.useWindowsTrust = useWindowsTrust;
	}

	public boolean isCheckCertIssuer() {
		return checkCertIssuer;
	}

	public void setCheckCertIssuer(boolean checkCertIssuer) {
		this.checkCertIssuer = checkCertIssuer;
	}

	public String getDefaultCertificateName() {
		return defaultCertificateName;
	}

	public void setDefaultCertificateName(String defaultCertificateName) {
		this.defaultCertificateName = defaultCertificateName;
	}

	public String getUser() {
		return user;
	}

	public void setUser(String user) {
		this.user = user;
	}

	public String getPass() {
		return encryptedPassword;
	}

	public void setPass(String pass) {
		this.encryptedPassword = pass;
	}

	public String getMaster() {
		return master;
	}

	public void setMaster(String master) {
		this.master = master;
	}

	/**
	 * Returns the git password, decrypting if necessary.
	 */
	public String getDecryptedPass() {
		// If no master defined, we presume password is plain text
		if (this.master == null) {
			return this.encryptedPassword;
		}
		BasicTextEncryptor bte = new BasicTextEncryptor();
		bte.setPassword(this.master);
		return bte.decrypt(this.encryptedPassword);
	}

	/**
	 * Returns an encrypted version of the git password, using the provided master
	 * password.
	 */
	public static String encryptPass(String masterPass, String pass) {
		BasicTextEncryptor bte = new BasicTextEncryptor();
		bte.setPassword(masterPass);
		return bte.encrypt(pass);
	}
	
	public Map<String, String> getRelays() {
		return relays;
	}
	public Map<String, String> getSecureRelays() {
		return secureRelays;
	}

	public static Config loadFromUserHome() {
		String userHome = System.getProperty("user.home");
		if (userHome == null) {
			return new Config();
		}
		try {
			return doLoadProperties();
		} catch (IOException e) {
			e.printStackTrace(System.err);
			return new Config();
		}
	}

	private static Config doLoadProperties() throws IOException, FileNotFoundException {
		File file = computeAgentPropertiesFile();
		System.out.printf("Loading properties from %s%n", file);
		if (!file.exists()) {
			return new Config();
		}

		try (FileInputStream fis = new FileInputStream(file)) {
			Properties p = new Properties();
			p.load(fis);
			Config result = new Config();
			result.setDefaultCertificateName(p.getProperty("default.cert.name"));
			result.setUseWindowsTrust(Boolean.parseBoolean(p.getProperty("use.windows.trust", "true")));
			result.setCheckCertIssuer(Boolean.parseBoolean(p.getProperty("check.cert.issuer", "true")));
			result.setTty(Boolean.parseBoolean(p.getProperty("use.tty")));
			result.setUser(p.getProperty("user"));
			result.setPass(p.getProperty("pass"));
			result.setMaster(p.getProperty("master"));

			p.keySet().stream()
				.map(Object::toString)
				.filter(Config::isRelayKey)
				.forEach(k -> result.addRelay(k, p.getProperty(k)));
				;
			p.keySet().stream()
				.map(Object::toString)
				.filter(Config::isSecuryRelayKey)
				.forEach(k -> result.addSecureRelay(k, p.getProperty(k)));
				;
			return result;
		}
	}
	private static boolean isRelayKey(String key) {
		return key.startsWith("relay.");
	}
	private void addRelay(String key, String value) {
		key = key.replaceFirst("^relay\\.", "");
		relays.put(key, value);
	}
	private static boolean isSecuryRelayKey(String key) {
		return key.startsWith("sslRelay.");
	}
	private void addSecureRelay(String key, String value) {
		key = key.replaceFirst("^sslRelay\\.", "");
		secureRelays.put(key, value);
	}
	
	public static File computeProfileFolder() {
		String userHome = System.getProperty("user.home");
		String configuration  = System.getProperty(COM_MOESOL_AGENT_CONFIG, "");
		String profile = System.getProperty(COM_MOESOL_AGENT_PROFILE, "");
		
		if (!configuration.isEmpty()) {
			return new File(configuration);
		}
		if (!profile.isEmpty()) {
			return new File(new File(userHome, CAC_AGENT_DIR), profile);
		} 
		return new File(userHome, CAC_AGENT_DIR);
	}

	private static File computeAgentPropertiesFile() {
		return new File(computeProfileFolder(), AGENT_PROPERTIES);
	}

}
