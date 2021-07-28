package com.moesol.cac.agent.selector;

import java.io.InputStream;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Properties;

public class X509PurposeDecoder {
	public static String[] NAMES = {
		"Digital Signature", //        (0),
		"Non-Repudiation", //          (1),
		"Key Encipherment", //         (2),
		"Data Encipherment", //        (3),
		"Key Agreement", //            (4),
		"Key Cert Sign", //            (5),
		"CRL Sign", //                 (6),
		"Encipher Only", //            (7),
		"Decipher Only", //            (8)
	};
	
	public static String decode(X509Certificate x509) {
		List<String> result = list(x509, false);
		return (result.isEmpty() ? "<missing>" : result.toString());
	}

	public static List<String> list(X509Certificate x509, boolean includeUnrecognized) {
		List<String> result = new ArrayList<>();

		// parse the OIDs in the extended key usage field first
		try {
			for (String oid : x509.getExtendedKeyUsage()) {
				String purpose = EXT_KEY_PURPOSES.getProperty(oid);
				if (purpose != null) {
					result.add(purpose);
				} else if (includeUnrecognized) {
					result.add(oid);
				}
			}
		} catch (Exception e) {
			// extended key usage field not present or unparseable
		}

		// next, add the values from the standard key usage field
		boolean[] usage = x509.getKeyUsage();
		if (usage != null) {
			for (int i = 0; i < NAMES.length; i++) {
				if (i >= usage.length) break;
				if (usage[i]) {
					result.add(NAMES[i]);
				}
			}
		}

		return result;
	}

	/**
	 * Register additional (potentially custom) OIDs for extended key usage
	 * that were not compiled into the cac-agent library.
	 * 
	 * If an application's target organization issues certificates with
	 * custom key usage OIDs, those can be added by calling this method.
	 * Items passed to this method will supplement/overwrite the values
	 * compiled into the cac-agent library.
	 * 
	 * @param oidDescriptions a Map whose keys are extended key usage OIDs,
	 *             and whose values are their user-friendly descriptions.
	 */
	public static void registerExtendedKeyUsageOIDs(Map oidDescriptions) {
		EXT_KEY_PURPOSES.putAll(oidDescriptions);
	}

	private static Properties loadExtendedKeyPurposeMap() {
		Properties baseDefinitions = new Properties();
		try {
			InputStream in = X509PurposeDecoder.class.getResourceAsStream("X509PurposeDecoder.txt");
			baseDefinitions.load(in);
			in.close();
		} catch (Exception e) {
		}
		return new Properties(baseDefinitions);
	}

	private static final Properties EXT_KEY_PURPOSES = loadExtendedKeyPurposeMap();

}
