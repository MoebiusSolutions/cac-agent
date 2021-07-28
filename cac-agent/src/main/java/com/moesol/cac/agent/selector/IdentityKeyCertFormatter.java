package com.moesol.cac.agent.selector;

import java.security.cert.X509Certificate;

public interface IdentityKeyCertFormatter {

	public String asText(String alias, X509Certificate x509);

	public String asHtml(String alias, X509Certificate x509);

}
