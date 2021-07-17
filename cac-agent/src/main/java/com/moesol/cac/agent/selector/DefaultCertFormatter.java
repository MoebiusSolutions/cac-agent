package com.moesol.cac.agent.selector;

import java.security.Principal;
import java.security.cert.X509Certificate;
import java.util.function.BiConsumer;

import javax.xml.stream.XMLStreamException;
import javax.xml.stream.XMLStreamWriter;

public class DefaultCertFormatter extends AbstractCertFormatter {

	public static final DefaultCertFormatter INSTANCE = new DefaultCertFormatter();

	@Override
	public String asText(String alias, X509Certificate x509) {
		StringBuilder result = new StringBuilder();
		writeCertData((tag, line) -> addTextLine(result, line), alias, x509);
		return result.toString();
	}

	protected void addTextLine(StringBuilder b, String line) {
		if (b.length() > 0) {
			b.append("\n    ");
		}
		b.append(line);
	}


	@Override
	protected void writeCertHtml(XMLStreamWriter xtw, String alias, X509Certificate x509) {
		writeCertData((tag, line) -> addHtmlLine(xtw, tag, line), alias, x509);
	}

	protected void addHtmlLine(XMLStreamWriter xtw, String tag, String line) {
		try {
			xtw.writeStartElement("p");
			if (!"b".equals(tag)) {
				writeIndent(xtw);
			}
			if (tag == null) {
				xtw.writeCharacters(line);
			} else {
				xtw.writeStartElement(tag);
				xtw.writeCharacters(line);
				xtw.writeEndElement();
			}
			xtw.writeEndElement();
		} catch (XMLStreamException x) {
		}
	}


	protected void writeCertData(BiConsumer<String, String> out, String alias, X509Certificate x509) {
		out.accept("b", getCertDisplayName(alias, x509));
		if (x509 == null) {
			out.accept("em", "[certificate unreadable]");
		} else {
			writeCertFields(out, x509);
		}
	}

	protected String getCertDisplayName(String alias, X509Certificate x509) {
		Principal subject = (x509 == null ? null : x509.getSubjectX500Principal());
		String display = X509DisplayUtils.getDisplay(subject);
		return display == null ? alias : display;
	}

	protected void writeCertFields(BiConsumer<String, String> out, X509Certificate x509) {
		maybeWriteLine(out, "em", X509PurposeDecoder.decode(x509));
		maybeWriteLine(out, null, X509DisplayUtils.getDisplay(x509.getIssuerX500Principal()));
		maybeWriteLine(out, null, X509DisplayUtils.getEmailAddress(x509));
		maybeWriteLine(out, null, X509DisplayUtils.getValidity(x509));
	}

	protected void maybeWriteLine(BiConsumer<String, String> out, String tag, String line) {
		if (line != null && line.length() > 0) {
			out.accept(tag, line);
		}
	}

}
