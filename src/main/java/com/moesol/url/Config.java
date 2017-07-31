package com.moesol.url;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.util.Properties;

public class Config {
	private boolean useWindowsTrust = false;
	private String defaultCertificateName = null;
	private boolean tty = false;
	
	public boolean isTty() {
		return tty ;
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
	
	public static Config loadFromUserHome() {
		String userHome = System.getProperty("user.home");
		if (userHome == null) { return new Config(); }
		try {
			return doLoadProperties(userHome);
		} catch (IOException e) {
			e.printStackTrace(System.err);
			return new Config();
		}
	}
	private static Config doLoadProperties(String userHome) throws IOException, FileNotFoundException {
		File file = new File(userHome, CacHookingAgent.CAC_AGENT_DIR + "/properties");
		if (!file.exists()) { return new Config(); }
		
		try (FileInputStream fis = new FileInputStream(file)) {
			Properties p = new Properties();
			p.load(fis);
			Config result = new Config();
			result.setDefaultCertificateName(p.getProperty("default.cert.name"));
			result.setUseWindowsTrust(Boolean.parseBoolean(p.getProperty("use.windows.trust")));
			result.setTty(Boolean.parseBoolean(p.getProperty("use.tty")));
			return result;
		}
	}
}
