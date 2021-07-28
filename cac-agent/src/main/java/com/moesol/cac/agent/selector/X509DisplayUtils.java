package com.moesol.cac.agent.selector;

import java.security.Principal;
import java.security.cert.X509Certificate;
import java.text.DateFormat;
import java.text.SimpleDateFormat;
import java.util.Collection;
import java.util.Date;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class X509DisplayUtils {

	/**
	 * Return a user-friendly value to display for a given Principal. This
	 * is the first "CN" or "OU" segment of the fully qualified name.
	 * 
	 * @param p
	 *            the principal to be formatted for display, may be null
	 * @return a user-friendly name to display, or null if the arg was null
	 */
	public static String getDisplay(Principal p) {
		if (p == null) {
			return null;
		} else {
			String name = p.getName();
			Matcher m = CN_PAT.matcher(name);
			return (m.find() ? m.group(2) : name);
		}
	}
	private static final Pattern CN_PAT = Pattern.compile("(CN|OU)=([^,]+)",
		Pattern.CASE_INSENSITIVE);


	/**
	 * Return the email address associated with a certificate, or null if
	 * the certificate does not have one.
	 * 
	 * This method looks in the subject alternative names field for RFC822
	 * names. If more than one is present, returns the first one found.
	 * 
	 * @param x509
	 *            a certificate to examine
	 * @return the first email address found in the certificate, or null
	 */
	public static String getEmailAddress(X509Certificate x509) {
		try {
			Collection<List<?>> altNames = x509.getSubjectAlternativeNames();
			if (altNames != null) {
				for (List<?> name : altNames) {
					if (RFC_822_NAME_KEY.equals(name.get(0))) {
						return (String) name.get(1);
					}
				}
			}
		} catch (Exception e) {
		}
		return null;
	}
	private static final Integer RFC_822_NAME_KEY = Integer.valueOf(1);


	/**
	 * Returns a string describing the validity period of a certificate.
	 * 
	 * @param x509
	 *            a certificate to examine
	 * @return a string in the form "Valid from: X - Y", or null if the
	 *         certificate does not have a validity period
	 */
	public static String getValidity(X509Certificate x509) {
		Date notBefore = x509.getNotBefore();
		Date notAfter = x509.getNotAfter();
		if (notBefore != null && notAfter != null) {
			return "Valid from: " + DATE_FMT.format(notBefore) + " - "
				+ DATE_FMT.format(notAfter);
		} else {
			return null;
		}
	}
	private static final DateFormat DATE_FMT = SimpleDateFormat.getDateInstance(DateFormat.SHORT);

}
