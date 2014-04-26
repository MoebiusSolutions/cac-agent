package com.moesol.cac.key.selector;

public class CertDescription {
	private final String alias;
	private final String desc;
	
	public CertDescription(String alias, String desc) {
		this.alias = alias;
		this.desc = desc;
	}

	@Override
	public String toString() {
		return desc;
	}

	public String getAlias() {
		return alias;
	}

}
