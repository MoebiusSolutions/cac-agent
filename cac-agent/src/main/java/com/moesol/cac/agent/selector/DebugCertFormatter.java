package com.moesol.cac.agent.selector;

import java.security.cert.X509Certificate;

import javax.xml.stream.XMLStreamException;
import javax.xml.stream.XMLStreamWriter;

public class DebugCertFormatter extends AbstractCertFormatter {

	public static final DebugCertFormatter INSTANCE = new DebugCertFormatter();

	public String asText(String alias, X509Certificate x509) {
		if (x509 == null) {
			return alias + " - [certificate unreadable]";
		}

		String purpose = X509PurposeDecoder.decode(x509);
		String principal = x509.getSubjectX500Principal().getName();
		String issuer = x509.getIssuerX500Principal().getName();
		return String.format("%s - %s%n  %s%n  %s", alias, purpose, principal, issuer);
	}

	@Override
	protected void writeCertHtml(XMLStreamWriter xtw, String alias, X509Certificate x509) throws XMLStreamException {
		if (x509 == null) {
			writeBadCertHtml(xtw, alias);
		} else {
			writeGoodCertHtml(xtw, alias, x509);
		}
	}

	protected void writeBadCertHtml(XMLStreamWriter xtw, String alias) throws XMLStreamException {
		xtw.writeStartElement("p");
		xtw.writeStartElement("em");
		xtw.writeCharacters(alias);
                xtw.writeCharacters(" - [certificate unreadable]");
		xtw.writeEndElement();
		xtw.writeEndElement();
	}

	protected void writeGoodCertHtml(XMLStreamWriter xtw, String alias, X509Certificate x509) throws XMLStreamException {
		String purpose = X509PurposeDecoder.decode(x509);
		String principal = x509.getSubjectX500Principal().getName();
		String issuer = x509.getIssuerX500Principal().getName();

		xtw.writeStartElement("p");
		xtw.writeStartElement("em");
		xtw.writeCharacters(alias + " - " + purpose);
		xtw.writeEndElement();
		xtw.writeEndElement();

		xtw.writeStartElement("p");
		writeIndent(xtw);
		xtw.writeCharacters(principal);
		xtw.writeEndElement();

		xtw.writeStartElement("p");
		writeIndent(xtw);
		xtw.writeCharacters(issuer);
		xtw.writeEndElement();
	}

}
