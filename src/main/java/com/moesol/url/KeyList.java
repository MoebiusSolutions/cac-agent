package com.moesol.url;

import java.security.KeyStore;
import java.util.Enumeration;

public class KeyList {

    /**
     * @param args
     */
    public static void main(String[] args) {
	try {
	    System.out.println(KeyStore.getDefaultType());
	    KeyStore ks = KeyStore.getInstance("Windows-MY");
	    ks.load(null, null);
	    
	    Enumeration<String> aliases = ks.aliases();
	    while (aliases.hasMoreElements()) {
		System.out.println(aliases.nextElement());
	    }
	} catch (Exception e) {
	    e.printStackTrace();
	}
    }

}
