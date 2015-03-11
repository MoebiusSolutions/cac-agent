package com.moesol.cac.agent.selector;

import java.io.StringWriter;

import javax.xml.stream.XMLOutputFactory;
import javax.xml.stream.XMLStreamWriter;

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
			return "<No Identifies Found>";			
		}
		return this.alias;
	}
	
	public String asHtml() {
		try {
			StringWriter sw = new StringWriter();
			XMLOutputFactory xof = XMLOutputFactory.newFactory();
			XMLStreamWriter xtw = xof.createXMLStreamWriter(sw);
			xtw.writeStartElement("html");

			xtw.writeStartElement("p");
			xtw.writeStartElement("em");
			xtw.writeCharacters(displayAlias() + " - " + purpose);
			xtw.writeEndElement();
			xtw.writeEndElement();
			
			xtw.writeStartElement("p");
			for (int i = 0; i < 4; i++) {
				xtw.writeEntityRef("nbsp");
			}
			xtw.writeCharacters(principal);
			xtw.writeEndElement();
			
			xtw.writeStartElement("p");
			for (int i = 0; i < 4; i++) {
				xtw.writeEntityRef("nbsp");
			}
			xtw.writeCharacters(issuer);
			xtw.writeEndElement();

			xtw.writeEndElement();
			xtw.close();
			
			return sw.toString();
		} catch (Exception e) {
			throw new RuntimeException(e);
		}
	}
	
}
