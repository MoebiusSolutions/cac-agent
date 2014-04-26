package com.moesol.cac.key.selector;

import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.List;

public class X509PurposeDecoder {
	public static String[] NAMES = {
		"digitalSignature", //        (0),
		"nonRepudiation", //          (1),
		"keyEncipherment", //         (2),
		"dataEncipherment", //        (3),
		"keyAgreement", //            (4),
		"keyCertSign", //             (5),
		"cRLSign", //                 (6),
		"encipherOnly", //            (7),
		"decipherOnly", //            (8)
	};
	
	public static String decode(X509Certificate x509) {
		List<String> result = new ArrayList<>();
		boolean[] usage = x509.getKeyUsage();
		if (usage == null) { return "<missing>"; }
		
		for (int i = 0; i < NAMES.length; i++) {
			if (i >= usage.length) break;
			if (usage[i]) {
				result.add(NAMES[i]);
			}
		}
		return result.toString();
	}
	
}
