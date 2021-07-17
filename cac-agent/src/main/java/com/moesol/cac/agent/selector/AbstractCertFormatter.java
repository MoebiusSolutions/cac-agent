package com.moesol.cac.agent.selector;

import java.io.StringWriter;
import java.security.cert.X509Certificate;

import javax.xml.stream.XMLOutputFactory;
import javax.xml.stream.XMLStreamException;
import javax.xml.stream.XMLStreamWriter;

public abstract class AbstractCertFormatter implements IdentityKeyCertFormatter {

	@Override
	public String asHtml(String alias, X509Certificate x509) {
		try {
			StringWriter sw = new StringWriter();
			XMLOutputFactory xof = XMLOutputFactory.newFactory();
			XMLStreamWriter xtw = xof.createXMLStreamWriter(sw);
			xtw.writeStartElement("html");

			writeCertHtml(xtw, alias, x509);

			xtw.writeEndElement();
			xtw.close();

			return sw.toString();
		} catch (Exception e) {
			throw new RuntimeException(e);
		}
	}

	protected abstract void writeCertHtml(XMLStreamWriter xtw, String alias, X509Certificate x509) throws XMLStreamException;

	protected void writeIndent(XMLStreamWriter xtw) throws XMLStreamException {
		for (int i = 0; i < 4; i++) {
			xtw.writeEntityRef("nbsp");
		}
	}

}
