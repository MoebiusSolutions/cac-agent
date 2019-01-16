package com.moesol.cac.agent;

import java.security.Provider;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.moesol.cac.agent.jdk_interface.Pkcs11SystemProvider;
import com.moesol.cac.agent.jdk_interface_11.Pkcs11SystemJdk11;
import com.moesol.cac.agent.jdk_interface_8.Pkcs11SystemJdk8;

// TODO [rkenney]: Try falling back to impementations on exceptions
public class Pkcs11System {

	private static final Pattern PRE_9_VERSION_PATTERN = Pattern.compile("1\\.(\\d+).*");
	private static final Pattern POST_9_VERSION_PATTERN = Pattern.compile("(\\d+).*");

	public static Provider getProvider(String configName) {
		String jreVersion = System.getProperty("java.version");
		Matcher matcher = PRE_9_VERSION_PATTERN.matcher(jreVersion);
		if (matcher.matches()) {
			int major = Integer.parseInt(matcher.group(1));
			switch (major) {
			case 8:
				return new Pkcs11SystemJdk8().getProvider(configName);
			default:
				throw throwUnmatchedException(jreVersion);
			}
		}
		matcher = POST_9_VERSION_PATTERN.matcher(jreVersion);
		if (matcher.matches()) {
			int major = Integer.parseInt(matcher.group(1));
			switch (major) {
			case 11:
				return new Pkcs11SystemJdk11().getProvider(configName);
			default:
				throw throwUnmatchedException(jreVersion);
			}
		}
		throw throwUnmatchedException(jreVersion);
	}
	
	private static RuntimeException throwUnmatchedException(String jreVersion) {
		throw new RuntimeException(String.format("No implementation of %s for JRE %s found. At the time of this writing, JRE 8 and 11 were known to be compatible.",
				Pkcs11SystemProvider.class.getSimpleName(), jreVersion));
	}
}
