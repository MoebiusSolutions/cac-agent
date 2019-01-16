package com.moesol.cac.agent;

import java.security.Provider;
import java.util.logging.Level;
import java.util.logging.Logger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.moesol.cac.agent.jdk_interface_11.Pkcs11SystemJdk11;
import com.moesol.cac.agent.jdk_interface_8.Pkcs11SystemJdk8;

// TODO [rkenney]: Try falling back to impementations on exceptions
public class Pkcs11System {

	private static final Pattern PRE_9_VERSION_PATTERN = Pattern.compile("1\\.(\\d+).*");
	private static final Pattern POST_9_VERSION_PATTERN = Pattern.compile("(\\d+).*");
	private static final Logger LOGGER = Logger.getLogger(Pkcs11System.class.getName());

	public static Provider getProvider(String configName) {
		String jreVersion = System.getProperty("java.version");
		Matcher matcher = PRE_9_VERSION_PATTERN.matcher(jreVersion);
		Integer major = null;
		if (matcher.matches()) {
			major = Integer.parseInt(matcher.group(1));
			if (major == 8) {
				LOGGER.log(Level.INFO, "Detected JRE8. Loading "+Pkcs11SystemJdk8.class.getSimpleName()+".");
				return new Pkcs11SystemJdk8().getProvider(configName);
			}
		}
		matcher = POST_9_VERSION_PATTERN.matcher(jreVersion);
		if (matcher.matches()) {
			major = Integer.parseInt(matcher.group(1));
			if (major >= 11) {
				LOGGER.log(Level.INFO, "Detected JRE11+. Loading "+Pkcs11SystemJdk11.class.getSimpleName()+".");
				return new Pkcs11SystemJdk11().getProvider(configName);
			}
		}
		LOGGER.log(Level.WARNING, String.format("Detected JRE%s. This is not a tested JRE (8 or 11). Attempting to use %s.",
				major, Pkcs11SystemJdk8.class.getSimpleName()));
		return new Pkcs11SystemJdk8().getProvider(configName);
	}
}
