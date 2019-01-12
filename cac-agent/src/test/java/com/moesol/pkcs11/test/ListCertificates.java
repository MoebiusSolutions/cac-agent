package com.moesol.pkcs11.test;

import java.security.KeyStore;

public class ListCertificates {

	public static void main(String[] args) throws Exception {
		KeyStore ks = KeyStore.getInstance("PKCS11");
		ks.load(null, null); 
	}

}
