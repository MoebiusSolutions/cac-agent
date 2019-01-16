package com.moesol.cac.agent.jdk_interface;

import java.security.Provider;

public interface Pkcs11SystemProvider {

	// TODO [rkenney]: Remove method
	boolean isCompatibleWithJre(String version);

	Provider getPkcs11Provider(String configName);
}
