package com.moesol.cac.agent.selector;

public class CertDescription {
	private final String alias;
	private final String principal;
	private final String purpose;
	private final String altNames;
	private final String issuer;
	
	public CertDescription(String alias, String principal, String purpose, String altNames, String issuer) {
		this.alias = alias;
		this.principal = principal;
		this.purpose = purpose;
		this.altNames = altNames;
		this.issuer = issuer;
	}

	@Override
	public String toString() {
		return altNames;
	}

	public String getAlias() {
		return alias;
	}
	
	public String getPurpose() {
		return purpose;
	}
	
	public String getIssuer() {
		return issuer;
	}
	
	String displayAlias() {
		if (this.alias == null) {
			return "&lt;No Identifies Found>";			
		}
		return this.alias;
	}
	
	public String asHtml() {
		StringBuilder sb = new StringBuilder();
		sb.append("<html>");
		sb.append("<em><b>");
		sb.append(displayAlias()).append(" - ").append(purpose);
		sb.append("</b></em><p>");
		sb.append("&nbsp;&nbsp;&nbsp;&nbsp;principal: ").append(principal).append("<p>");
		sb.append("&nbsp;&nbsp;&nbsp;&nbsp;issuer: ").append(issuer);
		sb.append("</html>");
		return sb.toString();
	}

}
