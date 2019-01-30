package com.moesol.cac.agent.jdk_interface;

import java.security.Provider;

public interface Pkcs11SystemProvider {

	Provider getProvider(String configName);
}
