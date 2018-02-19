package com.moesol.cac.agent;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.security.Key;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Properties;
import java.util.logging.Level;
import java.util.logging.Logger;

import javax.crypto.Cipher;
import javax.crypto.NoSuchPaddingException;
import javax.crypto.spec.PBEParameterSpec;

import org.jasypt.util.text.BasicTextEncryptor;

public class Config {
	private static final Logger LOGGER = Logger.getLogger(Config.class.getName());

	private boolean useWindowsTrust = true;
	private String defaultCertificateName = null;
	private boolean tty = false;
	private String user = null;
	private String encryptedPassword = null;
	private String master = null;

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


	public String decryptPass() {
		BasicTextEncryptor bte = new BasicTextEncryptor();
		bte.setPassword(getMaster());
		return bte.decrypt(getPass());
	}

	public static Config loadFromUserHome() {
		String userHome = System.getProperty("user.home");
		if (userHome == null) {
			return new Config();
		}
		try {
			return doLoadProperties(userHome);
		} catch (IOException e) {
			e.printStackTrace(System.err);
			return new Config();
		}
	}

	private static Config doLoadProperties(String userHome) throws IOException, FileNotFoundException {
		File file = new File(userHome, CacHookingAgent.CAC_AGENT_DIR + "/agent.properties");
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
			result.setTty(Boolean.parseBoolean(p.getProperty("use.tty")));
			result.setUser(p.getProperty("user"));
			result.setPass(p.getProperty("pass"));
			result.setMaster(p.getProperty("master"));
			return result;
		}
	}

}
