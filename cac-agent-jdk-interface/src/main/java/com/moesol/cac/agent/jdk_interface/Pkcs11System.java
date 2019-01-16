package com.moesol.cac.agent.jdk_interface;

import java.util.Iterator;
import java.util.ServiceLoader;

// TODO [rkenney]: Remove this service loader
public class Pkcs11System {
	
	public static Pkcs11SystemProvider get() {
		String jreVersion = System.getProperty("java.version");
		ServiceLoader<Pkcs11SystemProvider> loader = ServiceLoader.load(Pkcs11SystemProvider.class);
		Iterator<Pkcs11SystemProvider> i = loader.iterator();
		while (i.hasNext()) {
			Pkcs11SystemProvider provider = i.next();
			if (provider.isCompatibleWithJre(jreVersion)) {
				return provider;
			}
		}
		throw new RuntimeException(String.format("No implementation of %s for JRE %s. At the time of this writing, JRE 8 and 11 were known to be compatible.",
				com.moesol.cac.agent.jdk_interface.Pkcs11SystemProvider.class.getSimpleName(), jreVersion));
	}
}
