package com.moesol.cac.agent.selector;

import java.security.cert.X509Certificate;

public interface IdentityKeyListProvider {
	X509Certificate[] makeCertList(String[] aliases);
}