package com.moesol.cac.agent.selector;

public interface IdentityKeyListProvider {
	CertDescription[] makeCertList(String[] aliases);
}